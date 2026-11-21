import type { Pool, PoolClient } from 'pg';
import { MAX_PLACEMENT_PROBLEMS, placementStep } from '../shared/placement.ts';
import {
  effectiveLevel, gateDue, gradeAfterReveal, gradeForPractice, isRusty, restoresRust, xpForLevel, xpPerSkill, type Grade,
} from '../shared/xp.ts';
import { grade, type AnswerForm } from './grade.ts';

const MAX_ATTEMPTS_PER_MINUTE = 30;
const TEST_SIZE = 5;
const TEST_PASS_MARK = 4;
const TEST_GRADE: Record<number, Grade> = { 30: 'B', 60: 'A', 90: 'S' };
const PROBE_GRADE: Grade = 'B';
const PLACEMENT_LEVEL = 30;

export const json = (body: unknown, status = 200) => Response.json(body, { status });

// The row lock keeps one user's XP, tests and reveals from interleaving, so a check made here still holds at commit.
async function transaction<T>(pool: Pool, userId: string, work: (db: PoolClient) => Promise<T>) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('SELECT 1 FROM "user" WHERE id = $1 FOR NO KEY UPDATE', [userId]);
    const result = await work(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

// A failed gate can be neither retried nor passed for 24 hours, so a recent failure on the skill is always its next gate.
const gateColumns = (user: string, skill: string) => `
  (SELECT coalesce(array_agg(t.gate), '{}') FROM tests t
    WHERE t.user_id = ${user} AND t.skill_id = ${skill} AND t.passed) AS gates,
  (SELECT max(t.finished_at) + interval '24 hours' FROM tests t
    WHERE t.user_id = ${user} AND t.skill_id = ${skill} AND NOT t.passed
      AND t.finished_at > now() - interval '24 hours') AS retry_at`;

const PLACEMENT_AVAILABLE = `
  NOT EXISTS (SELECT 1 FROM xp_events WHERE user_id = $1)
  AND NOT EXISTS (SELECT 1 FROM tests WHERE user_id = $1 AND kind = 'placement')`;

const PLACEMENT_OPEN = `SELECT 1 FROM tests WHERE user_id = $1 AND kind = 'placement' AND finished_at IS NULL`;

export async function listSkills(pool: Pool, userId: string | undefined) {
  const user = [userId ?? null];
  const { rows } = await pool.query(
    `SELECT s.id, s.title_en, s.title_ja,
            coalesce(array_agg(sp.prerequisite_id) FILTER (WHERE sp.prerequisite_id IS NOT NULL), '{}') AS prerequisites,
            coalesce(p.xp, 0) AS xp, p.last_practiced_at, ${gateColumns('$1', 's.id')}
       FROM skills s
       LEFT JOIN skill_prerequisites sp ON sp.skill_id = s.id
       LEFT JOIN user_skill_progress p ON p.skill_id = s.id AND p.user_id = $1
      GROUP BY s.id, p.xp, p.last_practiced_at
      ORDER BY s.id`,
    user,
  );
  const status = await pool.query(
    `SELECT ${PLACEMENT_AVAILABLE} AS placement_available,
            (SELECT row_to_json(t) FROM (SELECT kind, skill_id AS "skillId", gate FROM tests
              WHERE user_id = $1 AND finished_at IS NULL) t) AS open_test`,
    user,
  );
  return json({
    skills: rows.map((r) => {
      const level = effectiveLevel(r.xp, r.gates);
      const gate = gateDue(r.xp, r.gates);
      return {
        id: r.id,
        title: { en: r.title_en, ja: r.title_ja },
        prerequisites: r.prerequisites,
        xp: r.xp,
        level,
        passedGates: r.gates,
        promotion: gate && { gate, retryAt: r.retry_at },
        rusty: isRusty(level, r.last_practiced_at, new Date()),
      };
    }),
    placementAvailable: userId !== undefined && status.rows[0].placement_available,
    openTest: status.rows[0].open_test,
  });
}

// $1 is the user wherever this is used.
const PROBLEM_COLUMNS = `p.grade, p.prompt_en, p.prompt_ja, p.prompt_latex,
  EXISTS (SELECT 1 FROM problem_instances r
           WHERE r.user_id = $1 AND r.problem_id = p.id AND r.revealed_at IS NOT NULL) AS revealed`;

const toProblem = (r: Record<string, unknown>) => ({
  instanceId: r.instance_id,
  grade: r.grade,
  prompt: { en: r.prompt_en, ja: r.prompt_ja },
  latex: r.prompt_latex,
  revealed: r.revealed,
});

// $1 is the user. Practice must stay away from these, or it gives unlimited tries at a one-shot test problem.
const inOpenTest = (problem: string) => `EXISTS (
  SELECT 1 FROM problem_instances ti JOIN tests t ON t.id = ti.test_id
   WHERE t.user_id = $1 AND t.finished_at IS NULL AND ti.problem_id = ${problem})`;

const GRADE_ORDER = `ARRAY['D', 'C', 'B', 'A', 'S']`;
const gradeDistance = (wanted: string) =>
  `abs(array_position(${GRADE_ORDER}, p.grade) - array_position(${GRADE_ORDER}, ${wanted}::text))`;

export function nextProblem(pool: Pool, userId: string, skillId: string) {
  return transaction(pool, userId, async (db) => {
    if ((await db.query(PLACEMENT_OPEN, [userId])).rowCount) return json({ error: 'test_open' }, 409);

    // An open problem comes back until it is answered, so a hard one cannot be rerolled. One already paid through
    // another of its skills has nothing left to give.
    const open = await db.query(
      `SELECT i.id AS instance_id, ${PROBLEM_COLUMNS}
         FROM problem_instances i
         JOIN problems p ON p.id = i.problem_id
         LEFT JOIN attempts a ON a.instance_id = i.id
        WHERE i.user_id = $1 AND i.skill_id = $2 AND i.test_id IS NULL AND a.id IS NULL
          AND NOT ${inOpenTest('i.problem_id')}
          AND NOT EXISTS (SELECT 1 FROM xp_events e WHERE e.user_id = $1 AND e.problem_id = i.problem_id)
        LIMIT 1`,
      [userId, skillId],
    );
    if (open.rows[0]) return json(toProblem(open.rows[0]));

    const progress = await db.query(
      `SELECT xp, last_practiced_at, ${gateColumns('$1', '$2')}
         FROM user_skill_progress WHERE user_id = $1 AND skill_id = $2`,
      [userId, skillId],
    );
    const level = effectiveLevel(progress.rows[0]?.xp ?? 0, progress.rows[0]?.gates ?? []);
    const wanted = gradeForPractice(level, isRusty(level, progress.rows[0]?.last_practiced_at ?? null, new Date()));
    // A revealed D can never pay, so it writes no xp_events row and would otherwise be picked forever.
    const created = await db.query(
      `WITH picked AS (
         SELECT p.id, ${PROBLEM_COLUMNS}
           FROM problems p
           JOIN problem_skills ps ON ps.problem_id = p.id AND ps.skill_id = $2
          WHERE NOT EXISTS (SELECT 1 FROM xp_events e WHERE e.user_id = $1 AND e.problem_id = p.id)
            AND NOT (p.grade = 'D' AND EXISTS (SELECT 1 FROM problem_instances r
                      WHERE r.user_id = $1 AND r.problem_id = p.id AND r.revealed_at IS NOT NULL))
            AND NOT ${inOpenTest('p.id')}
          ORDER BY ${gradeDistance('$3')}, random()
          LIMIT 1
       ), made AS (
         INSERT INTO problem_instances (user_id, problem_id, skill_id)
         SELECT $1, id, $2 FROM picked
         RETURNING id
       )
       SELECT made.id AS instance_id, picked.*
         FROM made, picked`,
      [userId, skillId, wanted],
    );
    return created.rows[0] ? json(toProblem(created.rows[0])) : json({ error: 'no_problems_left' }, 404);
  });
}

export function revealAnswer(pool: Pool, userId: string, instanceId: string) {
  return transaction(pool, userId, async (db) => {
    const { rows } = await db.query(
      `SELECT i.test_id, p.answer_latex,
              EXISTS (SELECT 1 FROM tests t WHERE t.user_id = $2 AND t.finished_at IS NULL) AS testing
         FROM problem_instances i
         JOIN problems p ON p.id = i.problem_id
        WHERE i.id = $1 AND i.user_id = $2`,
      [instanceId, userId],
    );
    if (!rows[0]) return json({ error: 'not_found' }, 404);
    // Any open test blocks it: a practice instance can hold the same problem as the test.
    if (rows[0].test_id || rows[0].testing) return json({ error: 'reveal_refused' }, 409);
    await db.query('UPDATE problem_instances SET revealed_at = coalesce(revealed_at, now()) WHERE id = $1', [instanceId]);
    return json({ answer: rows[0].answer_latex });
  });
}

async function addTestProblems(db: PoolClient, userId: string, testId: string, skillId: string, wanted: Grade, count: number) {
  const made = await db.query(
    `INSERT INTO problem_instances (user_id, problem_id, skill_id, test_id)
     SELECT $1, p.id, $2, $3
       FROM problems p
       JOIN problem_skills ps ON ps.problem_id = p.id AND ps.skill_id = $2
      WHERE NOT EXISTS (SELECT 1 FROM problem_instances i
                         WHERE i.user_id = $1 AND i.problem_id = p.id AND (i.revealed_at IS NOT NULL OR i.test_id = $3))
      ORDER BY ${gradeDistance('$4')},
               EXISTS (SELECT 1 FROM xp_events e WHERE e.user_id = $1 AND e.problem_id = p.id)
                 OR EXISTS (SELECT 1 FROM attempts a JOIN problem_instances s ON s.id = a.instance_id
                             WHERE s.user_id = $1 AND s.problem_id = p.id AND a.correct),
               random()
      LIMIT $5`,
    [userId, skillId, testId, wanted, count],
  );
  return made.rowCount ?? 0;
}

// Returns the final passed skills, or null once the next problem is in place.
async function probeOrFinish(db: PoolClient, userId: string, testId: string, answers: Record<string, unknown>[]) {
  const { rows: skills } = await db.query(
    `SELECT s.id, coalesce(array_agg(sp.prerequisite_id) FILTER (WHERE sp.prerequisite_id IS NOT NULL), '{}') AS prerequisites
       FROM skills s
       LEFT JOIN skill_prerequisites sp ON sp.skill_id = s.id
      GROUP BY s.id
      ORDER BY s.id`,
  );
  const history = answers.map((a) => ({ skillId: a.skill_id as string, correct: a.correct as boolean }));
  for (;;) {
    const step = placementStep(skills, history);
    if ('passed' in step) return step.passed;
    if (await addTestProblems(db, userId, testId, step.next, PROBE_GRADE, 1)) return null;
    // Nothing left to ask, for example when the player revealed the whole skill, so this step treats the probe as failed.
    history.push({ skillId: step.next, correct: false }, { skillId: step.next, correct: false });
  }
}

async function payPlacement(db: PoolClient, userId: string, skillIds: string[]) {
  const params = [userId, skillIds, xpForLevel(PLACEMENT_LEVEL)];
  await db.query(
    `INSERT INTO xp_events (user_id, skill_id, amount, reason) SELECT $1, unnest($2::text[]), $3::int, 'placement'`,
    params,
  );
  await db.query(
    `INSERT INTO user_skill_progress (user_id, skill_id, xp, last_practiced_at) SELECT $1, unnest($2::text[]), $3::int, now()`,
    params,
  );
}

// Moves a test on once all its problems are answered, then describes it. Safe to call on any state, so it also resumes.
async function advanceTest(db: PoolClient, userId: string, testId: string) {
  const { rows: [test] } = await db.query('SELECT kind, skill_id, gate, passed FROM tests WHERE id = $1', [testId]);
  const instances = async () => (await db.query(
    `SELECT i.id AS instance_id, i.skill_id, a.correct, ${PROBLEM_COLUMNS}
       FROM problem_instances i
       JOIN problems p ON p.id = i.problem_id
       LEFT JOIN attempts a ON a.instance_id = i.id
      WHERE i.test_id = $2
      ORDER BY i.created_at, i.id`,
    [userId, testId],
  )).rows;

  let rows = await instances();
  if (test.passed === null && rows.every((r) => r.correct !== null)) {
    if (test.kind === 'promotion') {
      test.passed = rows.filter((r) => r.correct).length >= TEST_PASS_MARK;
    } else {
      const placed = await probeOrFinish(db, userId, testId, rows);
      if (placed) {
        await payPlacement(db, userId, placed);
        test.passed = placed.length > 0;
      } else {
        rows = await instances();
      }
    }
    if (test.passed !== null) {
      await db.query('UPDATE tests SET passed = $2, finished_at = now() WHERE id = $1', [testId, test.passed]);
    }
  }

  const placed = test.kind === 'placement'
    ? await db.query(`SELECT skill_id FROM xp_events WHERE user_id = $1 AND reason = 'placement' ORDER BY skill_id`, [userId])
    : { rows: [] };
  const open = rows.find((r) => r.correct === null);
  return {
    kind: test.kind,
    skillId: test.skill_id,
    gate: test.gate,
    answered: rows.filter((r) => r.correct !== null).length,
    correct: rows.filter((r) => r.correct).length,
    total: test.kind === 'promotion' ? TEST_SIZE : MAX_PLACEMENT_PROBLEMS,
    passed: test.passed,
    problem: open ? toProblem(open) : null,
    placedSkills: placed.rows.map((r) => r.skill_id),
  };
}

const openTest = async (db: PoolClient, userId: string) =>
  (await db.query('SELECT id, kind, skill_id FROM tests WHERE user_id = $1 AND finished_at IS NULL', [userId])).rows[0];

export function startPromotion(pool: Pool, userId: string, skillId: string) {
  return transaction(pool, userId, async (db) => {
    const open = await openTest(db, userId);
    if (open?.skill_id === skillId) return json(await advanceTest(db, userId, open.id));
    if (open) return json({ error: 'test_open' }, 409);

    const { rows: [skill] } = await db.query(
      `SELECT coalesce(u.xp, 0) AS xp, ${gateColumns('$1', 's.id')}
         FROM skills s
         LEFT JOIN user_skill_progress u ON u.skill_id = s.id AND u.user_id = $1
        WHERE s.id = $2`,
      [userId, skillId],
    );
    if (!skill) return json({ error: 'not_found' }, 404);
    const gate = gateDue(skill.xp, skill.gates);
    if (!gate) return json({ error: 'test_not_available' }, 409);
    if (skill.retry_at) return json({ error: 'test_cooling_down', retryAt: skill.retry_at }, 409);

    const { rows: [test] } = await db.query(
      `INSERT INTO tests (user_id, kind, skill_id, gate) VALUES ($1, 'promotion', $2, $3) RETURNING id`,
      [userId, skillId, gate],
    );
    if ((await addTestProblems(db, userId, test.id, skillId, TEST_GRADE[gate], TEST_SIZE)) < TEST_SIZE) {
      await db.query('DELETE FROM tests WHERE id = $1', [test.id]);
      return json({ error: 'no_problems_left' }, 404);
    }
    return json(await advanceTest(db, userId, test.id));
  });
}

export function startPlacement(pool: Pool, userId: string) {
  return transaction(pool, userId, async (db) => {
    const open = await openTest(db, userId);
    if (open?.kind === 'placement') return json(await advanceTest(db, userId, open.id));
    if (open) return json({ error: 'test_open' }, 409);

    const { rows } = await db.query(`SELECT ${PLACEMENT_AVAILABLE} AS available`, [userId]);
    if (!rows[0].available) return json({ error: 'placement_unavailable' }, 409);
    const { rows: [test] } = await db.query(`INSERT INTO tests (user_id, kind) VALUES ($1, 'placement') RETURNING id`, [userId]);
    return json(await advanceTest(db, userId, test.id));
  });
}

// All XP is written from inside this transaction: practice below, placement through advanceTest.
// Every refusal comes before grade(), and only under the lock does the limit hold, so it bounds the grading too.
export function submitAttempt(pool: Pool, userId: string, instanceId: string, answer: string) {
  return transaction(pool, userId, async (db) => {
    const recent = await db.query(
      `SELECT count(*)::int AS n FROM attempts WHERE user_id = $1 AND created_at > now() - interval '1 minute'`,
      [userId],
    );
    if (recent.rows[0].n >= MAX_ATTEMPTS_PER_MINUTE) return json({ error: 'too_many_attempts' }, 429);

    const found = await db.query(
      `SELECT i.problem_id, i.test_id, p.grade, p.answer_latex, p.answer_form,
              EXISTS (SELECT 1 FROM attempts a WHERE a.instance_id = i.id) AS answered,
              i.test_id IS NULL AND (EXISTS (${PLACEMENT_OPEN}) OR ${inOpenTest('i.problem_id')}) AS blocked
         FROM problem_instances i
         JOIN problems p ON p.id = i.problem_id
        WHERE i.id = $2 AND i.user_id = $1`,
      [userId, instanceId],
    );
    const problem = found.rows[0];
    if (!problem) return json({ error: 'not_found' }, 404);
    if (problem.answered) {
      // The test state lets a client whose response was lost see where the test went, even if that answer finished it.
      return json({ error: 'already_answered', ...(problem.test_id && { test: await advanceTest(db, userId, problem.test_id) }) }, 409);
    }
    if (problem.blocked) return json({ error: 'test_open' }, 409);

    const correct = grade(answer, problem.answer_latex, problem.answer_form as AnswerForm);
    await db.query('INSERT INTO attempts (instance_id, user_id, answer, correct) VALUES ($1, $2, $3, $4)', [instanceId, userId, answer, correct]);
    if (problem.test_id) return json({ correct, awards: [], test: await advanceTest(db, userId, problem.test_id) });

    const revealed = await db.query(
      'SELECT 1 FROM problem_instances WHERE user_id = $1 AND problem_id = $2 AND revealed_at IS NOT NULL LIMIT 1',
      [userId, problem.problem_id],
    );
    const paidGrade = revealed.rowCount ? gradeAfterReveal(problem.grade as Grade) : (problem.grade as Grade);

    const awards: { skillId: string; xp: number }[] = [];
    if (correct && paidGrade) {
      const skills = await db.query(
        `SELECT ps.skill_id, coalesce(u.xp, 0) AS xp, u.last_practiced_at, ${gateColumns('$2', 'ps.skill_id')}
           FROM problem_skills ps
           LEFT JOIN user_skill_progress u ON u.skill_id = ps.skill_id AND u.user_id = $2
          WHERE ps.problem_id = $1`,
        [problem.problem_id, userId],
      );
      for (const skill of skills.rows) {
        const rusty = isRusty(effectiveLevel(skill.xp, skill.gates), skill.last_practiced_at, new Date());
        const amount = xpPerSkill(paidGrade, skills.rows.length, rusty);
        const paid = await db.query(
          `INSERT INTO xp_events (user_id, skill_id, problem_id, amount) VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, problem_id, skill_id) DO NOTHING`,
          [userId, skill.skill_id, problem.problem_id, amount],
        );
        if (paid.rowCount === 0) continue;
        await db.query(
          `INSERT INTO user_skill_progress (user_id, skill_id, xp, last_practiced_at) VALUES ($1, $2, $3, now())
           ON CONFLICT (user_id, skill_id)
           DO UPDATE SET xp = user_skill_progress.xp + EXCLUDED.xp,
             last_practiced_at = CASE WHEN $4 THEN now() ELSE user_skill_progress.last_practiced_at END`,
          [userId, skill.skill_id, amount, !rusty || restoresRust(paidGrade)],
        );
        awards.push({ skillId: skill.skill_id, xp: amount });
      }
    }
    return json({ correct, awards });
  });
}
