//! Sign-in with Google or LINE, and the session cookie. A player is a provider account and nothing more:
//! no email, name or provider token is stored.

use crate::{App, Error, json};
use axum::http::header::{COOKIE, LOCATION, SET_COOKIE};
use axum::http::{HeaderMap, StatusCode, Uri};
use axum::response::Response;
use serde_json::{Value, json as j};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row, query};

const SESSION_DAYS: i64 = 30;

struct Provider {
    authorize: &'static str,
    token: &'static str,
    profile: &'static str,
    scope: &'static str,
    id_field: &'static str,
    client_id: String,
    client_secret: String,
}

/// None when the provider is unknown or its keys are not set.
fn provider(name: &str) -> Option<Provider> {
    let key = |suffix: &str| std::env::var(format!("{}_{suffix}", name.to_uppercase())).ok().filter(|v| !v.is_empty());
    let (authorize, token, profile, scope, id_field) = match name {
        "google" => (
            "https://accounts.google.com/o/oauth2/v2/auth",
            "https://oauth2.googleapis.com/token",
            "https://openidconnect.googleapis.com/v1/userinfo",
            "openid",
            "sub",
        ),
        "line" => (
            "https://access.line.me/oauth2/v2.1/authorize",
            "https://api.line.me/oauth2/v2.1/token",
            "https://api.line.me/v2/profile",
            "profile",
            "userId",
        ),
        _ => return None,
    };
    Some(Provider { authorize, token, profile, scope, id_field, client_id: key("CLIENT_ID")?, client_secret: key("CLIENT_SECRET")? })
}

fn random_token() -> String {
    rand::random::<[u8; 32]>().iter().map(|b| format!("{b:02x}")).collect()
}

/// Only the hash is stored, so a copy of the database holds no usable session.
fn hash(token: &str) -> String {
    Sha256::digest(token.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

fn cookie<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    let all = headers.get(COOKIE)?.to_str().ok()?;
    all.split(';').filter_map(|pair| pair.trim().split_once('=')).find(|(key, _)| *key == name).map(|(_, value)| value)
}

fn set_cookie(app: &App, name: &str, value: &str, max_age: i64) -> String {
    let secure = if app.base_url.starts_with("https://") { "; Secure" } else { "" };
    format!("{name}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}{secure}")
}

fn redirect(to: &str, cookies: &[String]) -> Response {
    let mut response = Response::builder().status(StatusCode::FOUND).header(LOCATION, to);
    for cookie in cookies {
        response = response.header(SET_COOKIE, cookie);
    }
    response.body(Default::default()).expect("headers are plain ASCII")
}

pub async fn session_user(pool: &PgPool, headers: &HeaderMap) -> Result<Option<String>, sqlx::Error> {
    let Some(token) = cookie(headers, "session") else { return Ok(None) };
    let row = query(r#"SELECT "userId" FROM session WHERE token = $1 AND "expiresAt" > now()"#).bind(hash(token)).fetch_optional(pool).await?;
    Ok(row.map(|r| r.get("userId")))
}

async fn start_session(app: &App, user: &str) -> Result<String, sqlx::Error> {
    let token = random_token();
    query(r#"DELETE FROM session WHERE "expiresAt" < now()"#).execute(&app.pool).await?;
    query(&format!(
        r#"INSERT INTO session (id, "expiresAt", token, "updatedAt", "userId")
           VALUES ($1, now() + interval '{SESSION_DAYS} days', $2, now(), $3)"#
    ))
    .bind(random_token())
    .bind(hash(&token))
    .bind(user)
    .execute(&app.pool)
    .await?;
    Ok(set_cookie(app, "session", &token, SESSION_DAYS * 86_400))
}

/// Sends the browser to the provider. The state cookie ties the answer to this browser.
pub fn start(app: &App, name: &str) -> Result<Response, Error> {
    let Some(p) = provider(name) else { return Ok(json(404, j!({ "error": "not_found" }))) };
    let state = random_token();
    let url = reqwest::Url::parse_with_params(p.authorize, [
        ("response_type", "code"),
        ("client_id", &p.client_id),
        ("redirect_uri", &format!("{}/api/auth/callback/{name}", app.base_url)),
        ("scope", p.scope),
        ("state", &state),
    ])?;
    Ok(redirect(url.as_str(), &[set_cookie(app, "oauth_state", &state, 600)]))
}

pub async fn callback(app: &App, name: &str, uri: &Uri, headers: &HeaderMap) -> Result<Response, Error> {
    let Some(p) = provider(name) else { return Ok(json(404, j!({ "error": "not_found" }))) };
    let url = reqwest::Url::parse(&format!("http://localhost/?{}", uri.query().unwrap_or("")))?;
    let param = |key: &str| url.query_pairs().find(|(k, _)| k == key).map(|(_, v)| v.into_owned());
    let clear_state = set_cookie(app, "oauth_state", "", 0);
    let (Some(code), Some(state)) = (param("code"), param("state")) else { return Ok(redirect("/", &[clear_state])) };
    if cookie(headers, "oauth_state") != Some(state.as_str()) {
        return Ok(redirect("/", &[clear_state]));
    }

    let tokens: Value = app
        .http
        .post(p.token)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", &code),
            ("redirect_uri", &format!("{}/api/auth/callback/{name}", app.base_url)),
            ("client_id", &p.client_id),
            ("client_secret", &p.client_secret),
        ])
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let access_token = tokens["access_token"].as_str().ok_or("token response has no access_token")?;
    let profile: Value = app.http.get(p.profile).bearer_auth(access_token).send().await?.error_for_status()?.json().await?;
    let account = profile[p.id_field].as_str().ok_or("profile has no account id")?;

    let user = format!("{name}-{}", random_token());
    let mut tx = app.pool.begin().await?;
    query(r#"INSERT INTO "user" (id, name, "emailVerified") VALUES ($1, '', false)"#).bind(&user).execute(&mut *tx).await?;
    let made = query(
        r#"INSERT INTO account (id, "accountId", "providerId", "userId", "updatedAt") VALUES ($1, $2, $3, $4, now())
           ON CONFLICT ("providerId", "accountId") DO NOTHING"#,
    )
    .bind(random_token()).bind(account).bind(name).bind(&user).execute(&mut *tx).await?;
    let user = if made.rows_affected() == 1 {
        tx.commit().await?;
        user
    } else {
        // A returning player: drop the new user row and use theirs.
        tx.rollback().await?;
        query(r#"SELECT "userId" FROM account WHERE "providerId" = $1 AND "accountId" = $2"#).bind(name).bind(account).fetch_one(&app.pool).await?.get("userId")
    };
    Ok(redirect("/", &[clear_state, start_session(app, &user).await?]))
}

/// One shared test player, for local development only.
pub async fn dev_login(app: &App) -> Result<Response, Error> {
    if !app.dev_login || !app.base_url.starts_with("http://localhost") {
        return Ok(json(404, j!({ "error": "not_found" })));
    }
    query(r#"INSERT INTO "user" (id, name, "emailVerified") VALUES ('dev-player', '', false) ON CONFLICT (id) DO NOTHING"#).execute(&app.pool).await?;
    let mut response = json(200, j!({}));
    response.headers_mut().insert(SET_COOKIE, start_session(app, "dev-player").await?.parse()?);
    Ok(response)
}

pub async fn sign_out(app: &App, headers: &HeaderMap) -> Result<Response, Error> {
    if let Some(token) = cookie(headers, "session") {
        query("DELETE FROM session WHERE token = $1").bind(hash(token)).execute(&app.pool).await?;
    }
    let mut response = json(200, j!({}));
    response.headers_mut().insert(SET_COOKIE, set_cookie(app, "session", "", 0).parse()?);
    Ok(response)
}
