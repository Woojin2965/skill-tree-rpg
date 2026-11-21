//! The API: HTTP glue here, rules in game.rs, sign-in in auth.rs.

pub mod auth;
pub mod game;
pub mod grade;
pub mod placement;
pub mod xp;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::extract::{Request, State};
use axum::http::header::{CONTENT_TYPE, ORIGIN};
use axum::http::{Method, StatusCode};
use axum::response::Response;
use serde_json::{Value, json as j};
use sqlx::postgres::PgPoolOptions;
use sqlx::{PgPool, query};
use std::sync::Arc;

pub type Error = Box<dyn std::error::Error + Send + Sync>;
pub type Res = Result<Response, sqlx::Error>;

const MAX_BODY_BYTES: usize = 2048;
const MAX_ANSWER_CHARS: usize = 200;

pub struct App {
    pub pool: PgPool,
    /// The site's own origin, such as https://example.com, with no trailing slash.
    pub base_url: String,
    pub dev_login: bool,
    pub http: reqwest::Client,
}

pub fn json(status: u16, body: Value) -> Response {
    Response::builder()
        .status(StatusCode::from_u16(status).expect("status is a constant"))
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .expect("headers are constants")
}

enum Action {
    Placement,
    Next(String),
    Promotion(String),
    Reveal(String),
    Attempt(String, String),
}

fn is_uuid(text: &str) -> bool {
    text.len() == 36 && text.bytes().enumerate().all(|(i, b)| if [8, 13, 18, 23].contains(&i) { b == b'-' } else { matches!(b, b'0'..=b'9' | b'a'..=b'f') })
}

fn action(path: &str, body: &Value) -> Option<Action> {
    // Postgres text cannot hold NUL, so one would surface as a server error.
    let text = |key: &str| body[key].as_str().filter(|s| !s.contains('\0')).map(String::from);
    Some(match path {
        "/api/tests/placement" => Action::Placement,
        "/api/problems/next" => Action::Next(text("skillId")?),
        "/api/tests/promotion" => Action::Promotion(text("skillId")?),
        "/api/problems/reveal" => Action::Reveal(text("instanceId").filter(|id| is_uuid(id))?),
        "/api/attempts" => Action::Attempt(
            text("instanceId").filter(|id| is_uuid(id))?,
            text("answer").filter(|a| a.chars().count() <= MAX_ANSWER_CHARS)?,
        ),
        _ => return None,
    })
}

async fn route(app: &App, request: Request) -> Result<Response, Error> {
    let (parts, body) = request.into_parts();
    let (path, get, post) = (parts.uri.path(), parts.method == Method::GET, parts.method == Method::POST);
    let not_found = || Ok(json(404, j!({ "error": "not_found" })));

    // Browsers name the page a POST came from. One from another site is refused, on top of the SameSite cookie.
    if post && parts.headers.get(ORIGIN).is_some_and(|origin| origin.as_bytes() != app.base_url.as_bytes()) {
        return Ok(json(403, j!({ "error": "bad_origin" })));
    }

    if let Some(rest) = path.strip_prefix("/api/auth/") {
        return match rest {
            "google" | "line" if get => auth::start(app, rest),
            "callback/google" | "callback/line" if get => auth::callback(app, &rest[9..], &parts.uri, &parts.headers).await,
            "dev" if post => auth::dev_login(app).await,
            "sign-out" if post => auth::sign_out(app, &parts.headers).await,
            _ => not_found(),
        };
    }

    let user = auth::session_user(&app.pool, &parts.headers).await?;
    if get && path == "/api/skills" {
        return Ok(game::list_skills(&app.pool, user.as_deref()).await?);
    }
    if !post || action(path, &j!({ "skillId": "", "instanceId": "00000000-0000-0000-0000-000000000000", "answer": "" })).is_none() {
        return not_found();
    }
    let Some(user) = user else { return Ok(json(401, j!({ "error": "sign_in_required" }))) };
    let body = to_bytes(body, MAX_BODY_BYTES).await.ok().and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
    let Some(action) = body.filter(Value::is_object).and_then(|body| action(path, &body)) else {
        return Ok(json(400, j!({ "error": "bad_request" })));
    };

    // The row lock keeps one user's XP, tests and reveals from interleaving, so a check made here still holds at commit.
    let mut tx = app.pool.begin().await?;
    query(r#"SELECT 1 FROM "user" WHERE id = $1 FOR NO KEY UPDATE"#).bind(&user).execute(&mut *tx).await?;
    let response = match action {
        Action::Placement => game::start_placement(&mut tx, &user).await?,
        Action::Next(skill) => game::next_problem(&mut tx, &user, &skill).await?,
        Action::Promotion(skill) => game::start_promotion(&mut tx, &user, &skill).await?,
        Action::Reveal(instance) => game::reveal_answer(&mut tx, &user, &instance).await?,
        Action::Attempt(instance, answer) => game::submit_attempt(&mut tx, &user, &instance, &answer).await?,
    };
    tx.commit().await?;
    Ok(response)
}

async fn handle(State(app): State<Arc<App>>, request: Request) -> Response {
    let path = request.uri().path().to_string();
    route(&app, request).await.unwrap_or_else(|error| {
        eprintln!("{}", j!({ "message": "request failed", "path": path, "error": error.to_string() }));
        json(500, j!({ "error": "server_error" }))
    })
}

/// Reads DATABASE_URL, BASE_URL (or Vercel's production URL) and DEV_LOGIN.
pub fn router() -> Result<Router, Error> {
    let env = |name: &str| std::env::var(name).ok().filter(|v| !v.is_empty());
    let base_url = env("BASE_URL").or_else(|| env("VERCEL_PROJECT_PRODUCTION_URL").map(|host| format!("https://{host}"))).ok_or("BASE_URL is not set")?;
    let app = App {
        // Lazy, so a cold start does not wait for the database before it can answer.
        pool: PgPoolOptions::new().max_connections(5).connect_lazy(&env("DATABASE_URL").ok_or("DATABASE_URL is not set")?)?,
        base_url: base_url.trim_end_matches('/').to_string(),
        dev_login: env("DEV_LOGIN").as_deref() == Some("1"),
        http: reqwest::Client::new(),
    };
    Ok(Router::new().fallback(handle).with_state(Arc::new(app)))
}
