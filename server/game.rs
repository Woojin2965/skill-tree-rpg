//! Game rules over the database. Every function that writes runs inside the caller's transaction, which holds the
//! user's row lock, so one user's XP, tests and reveals never interleave.

use crate::grade::{Form, grade};
use crate::placement::{self, Step};
use crate::xp::{effective_level, gate_due, grade_after_reveal, grade_for_practice, is_rusty, restores_rust, xp_for_level, xp_per_skill};
use crate::{Res, json};
use serde_json::{Value, json as j};
use sqlx::postgres::PgRow;
use sqlx::{PgConnection, PgPool, Row, query};

const MAX_ATTEMPTS_PER_MINUTE: i32 = 30;
const TEST_SIZE: i64 = 5;
const TEST_PASS_MARK: usize = 4;
const PROBE_GRADE: &str = "B";
const PLACEMENT_LEVEL: i32 = 30;

// A failed gate can be neither retried nor passed for 24 hours, so a recent failure on the skill is always its next gate.
fn gate_columns(user: &str, skill: &str) -> String {
    format!(
        r#"(SELECT coalesce(array_agg(t.gate), '{{}}') FROM tests t
             WHERE t.user_id = {user} AND t.skill_id = {skill} AND t.passed) AS gates,
           (SELECT to_char((max(t.finished_at) + interval '24 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
              FROM tests t
             WHERE t.user_id = {user} AND t.skill_id = {skill} AND NOT t.passed
               AND t.finished_at > now() - interval '24 hours') AS retry_at"#
    )
}

const PLACEMENT_AVAILABLE: &str = "NOT EXISTS (SELECT 1 FROM xp_events WHERE user_id = $1)
  AND NOT EXISTS (SELECT 1 FROM tests WHERE user_id = $1 AND kind = 'placement')";

const PLACEMENT_OPEN: &str = "SELECT 1 FROM tests WHERE user_id = $1 AND kind = 'placement' AND finished_at IS NULL";

// $1 is the user wherever this is used. answer_latex is never among these columns.
const PROBLEM_COLUMNS: &str = "p.grade, p.prompt_en, p.prompt_ja, p.prompt_latex,
  EXISTS (SELECT 1 FROM problem_instances r
           WHERE r.user_id = $1 AND r.problem_id = p.id AND r.revealed_at IS NOT NULL) AS revealed";

// $1 is the user. Practice must stay away from these, or it gives unlimited tries at a one-shot test problem.
fn in_open_test(problem: &str) -> String {
    format!(
        "EXISTS (SELECT 1 FROM problem_instances ti JOIN tests t ON t.id = ti.test_id
                  WHERE t.user_id = $1 AND t.finished_at IS NULL AND ti.problem_id = {problem})"
    )
}

fn grade_distance(wanted: &str) -> String {
    const ORDER: &str = "ARRAY['D', 'C', 'B', 'A', 'S']";
    format!("abs(array_position({ORDER}, p.grade) - array_position({ORDER}, {wanted}::text))")
}

const IDLE: &str = "extract(epoch FROM now() - last_practiced_at)::float8";

fn to_problem(r: &PgRow) -> Value {
    j!({
        "instanceId": r.get::<String, _>("instance_id"),
        "grade": r.get::<String, _>("grade"),
        "prompt": { "en": r.get::<String, _>("prompt_en"), "ja": r.get::<String, _>("prompt_ja") },
        "latex": r.get::<String, _>("prompt_latex"),
        "revealed": r.get::<bool, _>("revealed"),
    })
}

pub async fn list_skills(pool: &PgPool, user: Option<&str>) -> Res {
    let rows = query(&format!(
        "SELECT s.id, s.title_en, s.title_ja,
                coalesce(array_agg(sp.prerequisite_id) FILTER (WHERE sp.prerequisite_id IS NOT NULL), '{{}}') AS prerequisites,
                coalesce(p.xp, 0) AS xp, {IDLE} AS idle, {}
           FROM skills s
           LEFT JOIN skill_prerequisites sp ON sp.skill_id = s.id
           LEFT JOIN user_skill_progress p ON p.skill_id = s.id AND p.user_id = $1
          GROUP BY s.id, p.xp, p.last_practiced_at
          ORDER BY s.id",
        gate_columns("$1", "s.id")
    ))
    .bind(user)
    .fetch_all(pool)
    .await?;
    let status = query(&format!(
        "SELECT {PLACEMENT_AVAILABLE} AS placement_available, t.kind, t.skill_id, t.gate
           FROM (SELECT 1) one LEFT JOIN tests t ON t.user_id = $1 AND t.finished_at IS NULL"
    ))
    .bind(user)
    .fetch_one(pool)
    .await?;

    let skills: Vec<Value> = rows
        .iter()
        .map(|r| {
            let (xp, gates): (i32, Vec<i32>) = (r.get("xp"), r.get("gates"));
            let level = effective_level(xp, &gates);
            let promotion = gate_due(xp, &gates).map(|gate| j!({ "gate": gate, "retryAt": r.get::<Option<String>, _>("retry_at") }));
            j!({
                "id": r.get::<String, _>("id"),
                "title": { "en": r.get::<String, _>("title_en"), "ja": r.get::<String, _>("title_ja") },
                "prerequisites": r.get::<Vec<String>, _>("prerequisites"),
                "xp": xp,
                "level": level,
                "passedGates": gates,
                "promotion": promotion,
                "rusty": is_rusty(level, r.get("idle")),
            })
        })
        .collect();
    let open_test = status.get::<Option<String>, _>("kind").map(|kind| {
        j!({ "kind": kind, "skillId": status.get::<Option<String>, _>("skill_id"), "gate": status.get::<Option<i32>, _>("gate") })
    });
    Ok(json(200, j!({
        "signedIn": user.is_some(),
        "skills": skills,
        "placementAvailable": user.is_some() && status.get::<bool, _>("placement_available"),
        "openTest": open_test,
    })))
}

pub async fn next_problem(db: &mut PgConnection, user: &str, skill: &str) -> Res {
    if query(PLACEMENT_OPEN).bind(user).fetch_optional(&mut *db).await?.is_some() {
        return Ok(json(409, j!({ "error": "test_open" })));
    }

    // An open problem comes back until it is answered, so a hard one cannot be rerolled. One already paid through
    // another of its skills has nothing left to give.
    let open = query(&format!(
        "SELECT i.id::text AS instance_id, {PROBLEM_COLUMNS}
           FROM problem_instances i
           JOIN problems p ON p.id = i.problem_id
           LEFT JOIN attempts a ON a.instance_id = i.id
          WHERE i.user_id = $1 AND i.skill_id = $2 AND i.test_id IS NULL AND a.id IS NULL
            AND NOT {}
            AND NOT EXISTS (SELECT 1 FROM xp_events e WHERE e.user_id = $1 AND e.problem_id = i.problem_id)
          LIMIT 1",
        in_open_test("i.problem_id")
    ))
    .bind(user)
    .bind(skill)
    .fetch_optional(&mut *db)
    .await?;
    if let Some(row) = open {
        return Ok(json(200, to_problem(&row)));
    }

    let progress = query(&format!(
        "SELECT xp, {IDLE} AS idle, {} FROM user_skill_progress WHERE user_id = $1 AND skill_id = $2",
        gate_columns("$1", "$2")
    ))
    .bind(user)
    .bind(skill)
    .fetch_optional(&mut *db)
    .await?;
    let (level, idle) = match &progress {
        Some(r) => (effective_level(r.get("xp"), &r.get::<Vec<i32>, _>("gates")), r.get("idle")),
        None => (1, None),
    };
    let wanted = grade_for_practice(level, is_rusty(level, idle));
    // A revealed D can never pay, so it writes no xp_events row and would otherwise be picked forever.
    let created = query(&format!(
        "WITH picked AS (
           SELECT p.id, {PROBLEM_COLUMNS}
             FROM problems p
             JOIN problem_skills ps ON ps.problem_id = p.id AND ps.skill_id = $2
            WHERE NOT EXISTS (SELECT 1 FROM xp_events e WHERE e.user_id = $1 AND e.problem_id = p.id)
              AND NOT (p.grade = 'D' AND EXISTS (SELECT 1 FROM problem_instances r
                        WHERE r.user_id = $1 AND r.problem_id = p.id AND r.revealed_at IS NOT NULL))
              AND NOT {}
            ORDER BY {}, random()
            LIMIT 1
         ), made AS (
           INSERT INTO problem_instances (user_id, problem_id, skill_id)
           SELECT $1, id, $2 FROM picked
           RETURNING id
         )
         SELECT made.id::text AS instance_id, picked.* FROM made, picked",
        in_open_test("p.id"),
        grade_distance("$3")
    ))
    .bind(user)
    .bind(skill)
    .bind(wanted)
    .fetch_optional(&mut *db)
    .await?;
    Ok(match created {
        Some(row) => json(200, to_problem(&row)),
        None => json(404, j!({ "error": "no_problems_left" })),
    })
}

/// The one place answer_latex leaves the server.
pub async fn reveal_answer(db: &mut PgConnection, user: &str, instance: &str) -> Res {
    let row = query(
        "SELECT i.test_id IS NOT NULL
                  OR EXISTS (SELECT 1 FROM tests t WHERE t.user_id = $2 AND t.finished_at IS NULL) AS testing,
                p.answer_latex
           FROM problem_instances i
           JOIN problems p ON p.id = i.problem_id
          WHERE i.id = $1::uuid AND i.user_id = $2",
    )
    .bind(instance)
    .bind(user)
    .fetch_optional(&mut *db)
    .await?;
    let Some(row) = row else { return Ok(json(404, j!({ "error": "not_found" }))) };
    // Any open test blocks it: a practice instance can hold the same problem as the test.
    if row.get("testing") {
        return Ok(json(409, j!({ "error": "reveal_refused" })));
    }
    query("UPDATE problem_instances SET revealed_at = coalesce(revealed_at, now()) WHERE id = $1::uuid").bind(instance).execute(&mut *db).await?;
    Ok(json(200, j!({ "answer": row.get::<String, _>("answer_latex") })))
}

/// Adds up to `count` problems to a test: never a revealed one, an unsolved one before a solved one.
async fn add_test_problems(db: &mut PgConnection, user: &str, test: &str, skill: &str, wanted: &str, count: i64) -> Result<u64, sqlx::Error> {
    let made = query(&format!(
        "INSERT INTO problem_instances (user_id, problem_id, skill_id, test_id)
         SELECT $1, p.id, $2, $3::uuid
           FROM problems p
           JOIN problem_skills ps ON ps.problem_id = p.id AND ps.skill_id = $2
          WHERE NOT EXISTS (SELECT 1 FROM problem_instances i
                             WHERE i.user_id = $1 AND i.problem_id = p.id AND (i.revealed_at IS NOT NULL OR i.test_id = $3::uuid))
          ORDER BY {},
                   EXISTS (SELECT 1 FROM xp_events e WHERE e.user_id = $1 AND e.problem_id = p.id)
                     OR EXISTS (SELECT 1 FROM attempts a JOIN problem_instances s ON s.id = a.instance_id
                                 WHERE s.user_id = $1 AND s.problem_id = p.id AND a.correct),
                   random()
          LIMIT $5",
        grade_distance("$4")
    ))
    .bind(user)
    .bind(skill)
    .bind(test)
    .bind(wanted)
    .bind(count)
    .execute(&mut *db)
    .await?;
    Ok(made.rows_affected())
}

/// The final passed skills, or None once the next problem is in place.
async fn probe_or_finish(db: &mut PgConnection, user: &str, test: &str, mut history: Vec<(String, bool)>) -> Result<Option<Vec<String>>, sqlx::Error> {
    let skills: Vec<placement::Skill> = query(
        "SELECT s.id, coalesce(array_agg(sp.prerequisite_id) FILTER (WHERE sp.prerequisite_id IS NOT NULL), '{}') AS prerequisites
           FROM skills s
           LEFT JOIN skill_prerequisites sp ON sp.skill_id = s.id
          GROUP BY s.id
          ORDER BY s.id",
    )
    .fetch_all(&mut *db)
    .await?
    .iter()
    .map(|r| placement::Skill { id: r.get("id"), prerequisites: r.get("prerequisites") })
    .collect();
    loop {
        let next = match placement::step(&skills, &history) {
            Step::Passed(passed) => return Ok(Some(passed)),
            Step::Next(next) => next,
        };
        if add_test_problems(db, user, test, &next, PROBE_GRADE, 1).await? > 0 {
            return Ok(None);
        }
        // Nothing left to ask, for example when the player revealed the whole skill, so the probe counts as failed.
        history.extend([(next.clone(), false), (next, false)]);
    }
}

async fn pay_placement(db: &mut PgConnection, user: &str, skills: &[String]) -> Result<(), sqlx::Error> {
    let xp = xp_for_level(PLACEMENT_LEVEL);
    query("INSERT INTO xp_events (user_id, skill_id, amount, reason) SELECT $1, unnest($2::text[]), $3::int, 'placement'")
        .bind(user).bind(skills).bind(xp).execute(&mut *db).await?;
    query("INSERT INTO user_skill_progress (user_id, skill_id, xp, last_practiced_at) SELECT $1, unnest($2::text[]), $3::int, now()")
        .bind(user).bind(skills).bind(xp).execute(&mut *db).await?;
    Ok(())
}

async fn test_instances(db: &mut PgConnection, user: &str, test: &str) -> Result<Vec<PgRow>, sqlx::Error> {
    query(&format!(
        "SELECT i.id::text AS instance_id, i.skill_id, a.correct, {PROBLEM_COLUMNS}
           FROM problem_instances i
           JOIN problems p ON p.id = i.problem_id
           LEFT JOIN attempts a ON a.instance_id = i.id
          WHERE i.test_id = $2::uuid
          ORDER BY i.created_at, i.id"
    ))
    .bind(user)
    .bind(test)
    .fetch_all(&mut *db)
    .await
}

/// Moves a test on once all its problems are answered, then describes it. Safe to call on any state, so it also resumes.
async fn advance_test(db: &mut PgConnection, user: &str, test: &str) -> Result<Value, sqlx::Error> {
    let row = query("SELECT kind, skill_id, gate, passed FROM tests WHERE id = $1::uuid").bind(test).fetch_one(&mut *db).await?;
    let kind: String = row.get("kind");
    let mut passed: Option<bool> = row.get("passed");
    let correct = |r: &PgRow| r.get::<Option<bool>, _>("correct");

    let mut rows = test_instances(db, user, test).await?;
    if passed.is_none() && rows.iter().all(|r| correct(r).is_some()) {
        if kind == "promotion" {
            passed = Some(rows.iter().filter(|r| correct(r) == Some(true)).count() >= TEST_PASS_MARK);
        } else {
            let history = rows.iter().map(|r| (r.get("skill_id"), correct(r) == Some(true))).collect();
            match probe_or_finish(db, user, test, history).await? {
                Some(placed) => {
                    pay_placement(db, user, &placed).await?;
                    passed = Some(!placed.is_empty());
                }
                None => rows = test_instances(db, user, test).await?,
            }
        }
        if let Some(passed) = passed {
            query("UPDATE tests SET passed = $2, finished_at = now() WHERE id = $1::uuid").bind(test).bind(passed).execute(&mut *db).await?;
        }
    }

    let placed: Vec<String> = if kind == "placement" {
        query("SELECT skill_id FROM xp_events WHERE user_id = $1 AND reason = 'placement' ORDER BY skill_id")
            .bind(user).fetch_all(&mut *db).await?.iter().map(|r| r.get("skill_id")).collect()
    } else {
        vec![]
    };
    Ok(j!({
        "kind": kind,
        "skillId": row.get::<Option<String>, _>("skill_id"),
        "gate": row.get::<Option<i32>, _>("gate"),
        "answered": rows.iter().filter(|r| correct(r).is_some()).count(),
        "correct": rows.iter().filter(|r| correct(r) == Some(true)).count(),
        "total": if kind == "promotion" { TEST_SIZE as usize } else { placement::MAX_PROBLEMS },
        "passed": passed,
        "problem": rows.iter().find(|r| correct(r).is_none()).map(to_problem),
        "placedSkills": placed,
    }))
}

async fn open_test(db: &mut PgConnection, user: &str) -> Result<Option<PgRow>, sqlx::Error> {
    query("SELECT id::text AS id, kind, skill_id FROM tests WHERE user_id = $1 AND finished_at IS NULL").bind(user).fetch_optional(&mut *db).await
}

pub async fn start_promotion(db: &mut PgConnection, user: &str, skill: &str) -> Res {
    if let Some(open) = open_test(db, user).await? {
        if open.get::<Option<String>, _>("skill_id").as_deref() != Some(skill) {
            return Ok(json(409, j!({ "error": "test_open" })));
        }
        return Ok(json(200, advance_test(db, user, &open.get::<String, _>("id")).await?));
    }

    let row = query(&format!(
        "SELECT coalesce(u.xp, 0) AS xp, {}
           FROM skills s
           LEFT JOIN user_skill_progress u ON u.skill_id = s.id AND u.user_id = $1
          WHERE s.id = $2",
        gate_columns("$1", "s.id")
    ))
    .bind(user)
    .bind(skill)
    .fetch_optional(&mut *db)
    .await?;
    let Some(row) = row else { return Ok(json(404, j!({ "error": "not_found" }))) };
    let Some(gate) = gate_due(row.get("xp"), &row.get::<Vec<i32>, _>("gates")) else {
        return Ok(json(409, j!({ "error": "test_not_available" })));
    };
    if let Some(retry_at) = row.get::<Option<String>, _>("retry_at") {
        return Ok(json(409, j!({ "error": "test_cooling_down", "retryAt": retry_at })));
    }

    let test: String = query("INSERT INTO tests (user_id, kind, skill_id, gate) VALUES ($1, 'promotion', $2, $3) RETURNING id::text AS id")
        .bind(user).bind(skill).bind(gate).fetch_one(&mut *db).await?.get("id");
    let wanted = match gate {
        30 => "B",
        60 => "A",
        _ => "S",
    };
    if add_test_problems(db, user, &test, skill, wanted, TEST_SIZE).await? < TEST_SIZE as u64 {
        query("DELETE FROM tests WHERE id = $1::uuid").bind(&test).execute(&mut *db).await?;
        return Ok(json(404, j!({ "error": "no_problems_left" })));
    }
    Ok(json(200, advance_test(db, user, &test).await?))
}

pub async fn start_placement(db: &mut PgConnection, user: &str) -> Res {
    if let Some(open) = open_test(db, user).await? {
        if open.get::<String, _>("kind") != "placement" {
            return Ok(json(409, j!({ "error": "test_open" })));
        }
        return Ok(json(200, advance_test(db, user, &open.get::<String, _>("id")).await?));
    }
    let available: bool = query(&format!("SELECT {PLACEMENT_AVAILABLE} AS available")).bind(user).fetch_one(&mut *db).await?.get("available");
    if !available {
        return Ok(json(409, j!({ "error": "placement_unavailable" })));
    }
    let test: String = query("INSERT INTO tests (user_id, kind) VALUES ($1, 'placement') RETURNING id::text AS id").bind(user).fetch_one(&mut *db).await?.get("id");
    Ok(json(200, advance_test(db, user, &test).await?))
}

/// All XP is written from here: practice below, placement through advance_test.
/// Every refusal comes before grade(), and the limit holds under the user's lock, so it bounds the grading too.
pub async fn submit_attempt(db: &mut PgConnection, user: &str, instance: &str, answer: &str) -> Res {
    let recent: i32 = query("SELECT count(*)::int AS n FROM attempts WHERE user_id = $1 AND created_at > now() - interval '1 minute'")
        .bind(user).fetch_one(&mut *db).await?.get("n");
    if recent >= MAX_ATTEMPTS_PER_MINUTE {
        return Ok(json(429, j!({ "error": "too_many_attempts" })));
    }

    let found = query(&format!(
        "SELECT i.problem_id, i.test_id::text AS test_id, p.grade, p.answer_latex, p.answer_form,
                EXISTS (SELECT 1 FROM attempts a WHERE a.instance_id = i.id) AS answered,
                i.test_id IS NULL AND (EXISTS ({PLACEMENT_OPEN}) OR {}) AS blocked
           FROM problem_instances i
           JOIN problems p ON p.id = i.problem_id
          WHERE i.id = $2::uuid AND i.user_id = $1",
        in_open_test("i.problem_id")
    ))
    .bind(user)
    .bind(instance)
    .fetch_optional(&mut *db)
    .await?;
    let Some(problem) = found else { return Ok(json(404, j!({ "error": "not_found" }))) };
    let test: Option<String> = problem.get("test_id");
    if problem.get("answered") {
        // The test state lets a client whose response was lost see where the test went, even if that answer finished it.
        let mut body = j!({ "error": "already_answered" });
        if let Some(test) = &test {
            body["test"] = advance_test(db, user, test).await?;
        }
        return Ok(json(409, body));
    }
    if problem.get("blocked") {
        return Ok(json(409, j!({ "error": "test_open" })));
    }

    let problem_id: String = problem.get("problem_id");
    let form = Form::parse(problem.get("answer_form")).expect("answer_form is checked by the database");
    let correct = grade(answer, problem.get("answer_latex"), form);
    query("INSERT INTO attempts (instance_id, user_id, answer, correct) VALUES ($1::uuid, $2, $3, $4)")
        .bind(instance).bind(user).bind(answer).bind(correct).execute(&mut *db).await?;
    if let Some(test) = &test {
        return Ok(json(200, j!({ "correct": correct, "awards": [], "test": advance_test(db, user, test).await? })));
    }

    let revealed = query("SELECT 1 FROM problem_instances WHERE user_id = $1 AND problem_id = $2 AND revealed_at IS NOT NULL LIMIT 1")
        .bind(user).bind(&problem_id).fetch_optional(&mut *db).await?.is_some();
    let grade_name: String = problem.get("grade");
    let paid_grade = if revealed { grade_after_reveal(&grade_name) } else { Some(grade_name.as_str()) };

    let mut awards = Vec::new();
    if let (true, Some(paid_grade)) = (correct, paid_grade) {
        let skills = query(&format!(
            "SELECT ps.skill_id, coalesce(u.xp, 0) AS xp, extract(epoch FROM now() - u.last_practiced_at)::float8 AS idle, {}
               FROM problem_skills ps
               LEFT JOIN user_skill_progress u ON u.skill_id = ps.skill_id AND u.user_id = $2
              WHERE ps.problem_id = $1",
            gate_columns("$2", "ps.skill_id")
        ))
        .bind(&problem_id)
        .bind(user)
        .fetch_all(&mut *db)
        .await?;
        for skill in &skills {
            let skill_id: String = skill.get("skill_id");
            let rusty = is_rusty(effective_level(skill.get("xp"), &skill.get::<Vec<i32>, _>("gates")), skill.get("idle"));
            let amount = xp_per_skill(paid_grade, skills.len(), rusty);
            let paid = query(
                "INSERT INTO xp_events (user_id, skill_id, problem_id, amount) VALUES ($1, $2, $3, $4)
                 ON CONFLICT (user_id, problem_id, skill_id) DO NOTHING",
            )
            .bind(user).bind(&skill_id).bind(&problem_id).bind(amount).execute(&mut *db).await?;
            if paid.rows_affected() == 0 {
                continue;
            }
            query(
                "INSERT INTO user_skill_progress (user_id, skill_id, xp, last_practiced_at) VALUES ($1, $2, $3, now())
                 ON CONFLICT (user_id, skill_id)
                 DO UPDATE SET xp = user_skill_progress.xp + EXCLUDED.xp,
                   last_practiced_at = CASE WHEN $4::bool THEN now() ELSE user_skill_progress.last_practiced_at END",
            )
            .bind(user).bind(&skill_id).bind(amount).bind(!rusty || restores_rust(paid_grade)).execute(&mut *db).await?;
            awards.push(j!({ "skillId": skill_id, "xp": amount }));
        }

        // Direct prerequisites not on the problem get their share of the plain amount. It is XP, not practice:
        // last_practiced_at stays, so it never clears rust. The problem_id key still pays each skill once.
        if !awards.is_empty() {
            let paid = query(
                "WITH shares AS (
                   SELECT sp.prerequisite_id AS skill_id, ($3 * sum(sp.share) / 100)::int AS amount
                     FROM problem_skills ps JOIN skill_prerequisites sp ON sp.skill_id = ps.skill_id
                    WHERE ps.problem_id = $1 AND sp.prerequisite_id NOT IN (SELECT skill_id FROM problem_skills WHERE problem_id = $1)
                    GROUP BY sp.prerequisite_id
                 ), paid AS (
                   INSERT INTO xp_events (user_id, skill_id, problem_id, amount) SELECT $2, skill_id, $1, amount FROM shares WHERE amount > 0
                   ON CONFLICT (user_id, problem_id, skill_id) DO NOTHING RETURNING skill_id, amount
                 ), progress AS (
                   INSERT INTO user_skill_progress (user_id, skill_id, xp) SELECT $2, skill_id, amount FROM paid
                   ON CONFLICT (user_id, skill_id) DO UPDATE SET xp = user_skill_progress.xp + EXCLUDED.xp
                 )
                 SELECT skill_id, amount FROM paid ORDER BY skill_id",
            )
            .bind(&problem_id).bind(user).bind(xp_per_skill(paid_grade, skills.len(), false))
            .fetch_all(&mut *db)
            .await?;
            awards.extend(paid.iter().map(|r| j!({ "skillId": r.get::<String, _>("skill_id"), "xp": r.get::<i32, _>("amount") })));
        }
    }
    Ok(json(200, j!({ "correct": correct, "awards": awards })))
}
