import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { after, describe, test } from 'node:test';
import { Pool } from 'pg';
import { xpForLevel, type Grade } from '../src/shared/xp.ts';

// Black-box tests of the Rust server over HTTP. Needs scripts/db.sh start and reset, and cargo build.
// Each test makes its own users and removes them at the end.
const DATABASE_URL = 'postgres://postgres@localhost:5433/knowledge_rpg';
const API = 'http://127.0.0.1:8788';
const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
const ready = await pool.query('SELECT 1 FROM problems LIMIT 1').then((r) => r.rowCount === 1, () => false);

const server = spawn('target/debug/index', {
  env: { ...process.env, DATABASE_URL, BASE_URL: 'http://localhost:5173', LOCAL_PORT: '8788', DEV_LOGIN: '' },
  stdio: ['ignore', 'inherit', 'inherit'],
});
for (let i = 0; ready && i < 100; i++) {
  if (await fetch(`${API}/api/skills`).then((r) => r.ok, () => false)) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}

const sessions = new Map<string, string>();

function api(user: string | undefined, path: string, body?: unknown, origin?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (user) headers.cookie = `session=${sessions.get(user)}`;
  if (origin) headers.origin = origin;
  return fetch(API + path, body === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(body) });
}

// The names and arguments the tests were written against, when the rules were TypeScript functions.
const listSkills = (_: Pool, user: string | undefined) => api(user, '/api/skills');
const nextProblem = (_: Pool, user: string, skillId: string) => api(user, '/api/problems/next', { skillId });
const revealAnswer = (_: Pool, user: string, instanceId: string) => api(user, '/api/problems/reveal', { instanceId });
const startPromotion = (_: Pool, user: string, skillId: string) => api(user, '/api/tests/promotion', { skillId });
const startPlacement = (_: Pool, user: string) => api(user, '/api/tests/placement', {});
const submitAttempt = (_: Pool, user: string, instanceId: string, answer: string) => api(user, '/api/attempts', { instanceId, answer });

const users: string[] = [];
const seen: { body: unknown; text: string }[] = [];
const DAY_MS = 86_400_000;
const WRONG = '12345';

after(async () => {
  if (ready) await pool.query('DELETE FROM "user" WHERE id = ANY($1)', [users]);
  await pool.end();
  server.kill();
});

async function call(response: Promise<Response>) {
  const res = await response;
  const text = await res.text();
  const body = JSON.parse(text);
  seen.push({ body, text });
  return { status: res.status, body };
}

async function newUser() {
  const id = `game-test-${crypto.randomUUID()}`;
  users.push(id);
  await pool.query(`INSERT INTO "user" (id, name, "emailVerified") VALUES ($1, 'test', true)`, [id]);
  const token = crypto.randomUUID();
  sessions.set(id, token);
  await pool.query(
    `INSERT INTO session (id, "expiresAt", token, "updatedAt", "userId") VALUES ($1, now() + interval '1 hour', $2, now(), $3)`,
    [crypto.randomUUID(), createHash('sha256').update(token).digest('hex'), id],
  );
  return id;
}

async function setXp(user: string, skill: string, xp: number, daysAgo = 0) {
  await pool.query(
    `INSERT INTO user_skill_progress (user_id, skill_id, xp, last_practiced_at) VALUES ($1, $2, $3, $4)`,
    [user, skill, xp, new Date(Date.now() - daysAgo * DAY_MS)],
  );
}

const pickProblem = async (grade: Grade, skill: string): Promise<string> =>
  (await pool.query(
    `SELECT p.id FROM problems p JOIN problem_skills ps ON ps.problem_id = p.id
      WHERE p.grade = $1 AND ps.skill_id = $2 ORDER BY p.id LIMIT 1`,
    [grade, skill],
  )).rows[0].id;

const openInstance = async (user: string, problem: string, skill: string): Promise<string> =>
  (await pool.query(
    'INSERT INTO problem_instances (user_id, problem_id, skill_id) VALUES ($1, $2, $3) RETURNING id',
    [user, problem, skill],
  )).rows[0].id;

const answerOf = async (instanceId: string): Promise<string> =>
  (await pool.query(
    'SELECT p.answer_latex FROM problem_instances i JOIN problems p ON p.id = i.problem_id WHERE i.id = $1',
    [instanceId],
  )).rows[0].answer_latex;

const solve = async (user: string, instanceId: string) =>
  call(submitAttempt(pool, user, instanceId, await answerOf(instanceId)));

const xpOf = async (user: string, skill: string): Promise<number> =>
  (await pool.query('SELECT xp FROM user_skill_progress WHERE user_id = $1 AND skill_id = $2', [user, skill])).rows[0]?.xp ?? 0;

const eventCount = async (user: string): Promise<number> =>
  (await pool.query('SELECT count(*)::int AS n FROM xp_events WHERE user_id = $1', [user])).rows[0].n;

const lastPracticed = async (user: string, skill: string): Promise<Date> =>
  (await pool.query('SELECT last_practiced_at FROM user_skill_progress WHERE user_id = $1 AND skill_id = $2', [user, skill])).rows[0].last_practiced_at;

const skillOf = async (user: string, id: string) =>
  (await call(listSkills(pool, user))).body.skills.find((s: { id: string }) => s.id === id);

// Answers a promotion test, getting the first `right` problems correct.
async function takeTest(user: string, first: { problem: { instanceId: string } | null }, right: number) {
  let test = first;
  for (let i = 0; test.problem; i++) {
    const id = test.problem.instanceId;
    const { body } = await call(submitAttempt(pool, user, id, i < right ? await answerOf(id) : WRONG));
    test = body.test;
  }
  return test as unknown as Record<string, unknown>;
}

async function takePlacement(user: string, known: string[]) {
  const probed = new Set<string>();
  let test = (await call(startPlacement(pool, user))).body;
  while (test.problem) {
    const id = test.problem.instanceId;
    const { rows } = await pool.query('SELECT skill_id FROM problem_instances WHERE id = $1', [id]);
    probed.add(rows[0].skill_id);
    const answer = known.includes(rows[0].skill_id) ? await answerOf(id) : WRONG;
    test = (await call(submitAttempt(pool, user, id, answer))).body.test;
  }
  return { test, probed };
}

describe('game rules', { skip: !ready && 'local database is not running' }, () => {
  describe('reveal', () => {
    test('returns the answer to the owner only', async () => {
      const user = await newUser();
      const stranger = await newUser();
      const id = await openInstance(user, await pickProblem('D', 'expanding'), 'expanding');
      assert.equal((await call(revealAnswer(pool, stranger, id))).status, 404);
      const { status, body } = await call(revealAnswer(pool, user, id));
      assert.equal(status, 200);
      assert.deepEqual(body, { answer: await answerOf(id) });
      seen.pop();
    });

    test('lowers XP, and answering wrong to get the problem again does not restore it', async () => {
      const user = await newUser();
      const problem = await pickProblem('C', 'expanding');
      const first = await openInstance(user, problem, 'expanding');
      await revealAnswer(pool, user, first);
      assert.equal((await call(submitAttempt(pool, user, first, WRONG))).body.correct, false);
      assert.equal(await xpOf(user, 'expanding'), 0);

      const second = await openInstance(user, problem, 'expanding');
      const { body } = await solve(user, second);
      assert.deepEqual(body, { correct: true, awards: [{ skillId: 'expanding', xp: 50 }, { skillId: 'linear-equations', xp: 10 }] });
    });

    test('a next problem says when its reveal already applies', async () => {
      const user = await newUser();
      const { body } = await call(nextProblem(pool, user, 'expanding'));
      assert.equal(body.revealed, false);
      await revealAnswer(pool, user, body.instanceId);
      assert.equal((await call(nextProblem(pool, user, 'expanding'))).body.revealed, true);
    });

    test('a revealed D pays nothing and writes no XP row', async () => {
      const user = await newUser();
      const id = await openInstance(user, await pickProblem('D', 'expanding'), 'expanding');
      await revealAnswer(pool, user, id);
      assert.deepEqual((await solve(user, id)).body, { correct: true, awards: [] });
      assert.equal(await eventCount(user), 0);
      assert.equal(await xpOf(user, 'expanding'), 0);
    });

    test('a revealed D leaves the pool, so a skill can move on to grade C', async () => {
      const user = await newUser();
      const { rows } = await pool.query(
        `SELECT p.id FROM problems p JOIN problem_skills ps ON ps.problem_id = p.id
          WHERE p.grade = 'D' AND ps.skill_id = 'expanding' ORDER BY p.id`,
      );
      const [revealed, ...rest] = rows.map((r) => r.id);
      for (const id of rest) await pool.query(
        `INSERT INTO xp_events (user_id, skill_id, problem_id, amount) VALUES ($1, 'expanding', $2, 50)`, [user, id]);
      await setXp(user, 'expanding', 50 * rest.length);
      const id = await openInstance(user, revealed, 'expanding');
      await revealAnswer(pool, user, id);
      await solve(user, id);
      assert.equal((await call(nextProblem(pool, user, 'expanding'))).body.grade, 'C');
    });

    test('the lowered grade still splits across skills', async () => {
      const user = await newUser();
      const problem = await pickProblem('S', 'partial-derivatives');
      const other = await newUser();
      const plain = await solve(other, await openInstance(other, problem, 'partial-derivatives'));
      assert.deepEqual(plain.body.awards.slice(0, 3).map((a: { xp: number }) => a.xp), [6666, 6666, 6666]);

      const id = await openInstance(user, problem, 'partial-derivatives');
      await revealAnswer(pool, user, id);
      const { body } = await solve(user, id);
      assert.deepEqual(body.awards.slice(0, 3).map((a: { xp: number }) => a.xp), [1666, 1666, 1666]);
      assert.equal(await eventCount(user), body.awards.length);
    });

    test('direct prerequisites get their share once, as XP but not practice', async () => {
      const user = await newUser();
      const problem = await pickProblem('D', 'linear-equations');
      const { body } = await solve(user, await openInstance(user, problem, 'linear-equations'));
      assert.deepEqual(body.awards, [{ skillId: 'linear-equations', xp: 50 }, { skillId: 'arithmetic', xp: 15 }]);
      assert.equal(await lastPracticed(user, 'arithmetic'), null);
      assert.deepEqual((await solve(user, await openInstance(user, problem, 'linear-equations'))).body.awards, []);
      assert.equal(await xpOf(user, 'arithmetic'), 15);
    });

    test('a prerequisite already on the problem gets no extra share', async () => {
      const user = await newUser();
      const { rows: [{ id }] } = await pool.query(
        `SELECT problem_id AS id FROM problem_skills WHERE skill_id IN ('arithmetic', 'linear-equations')
          GROUP BY problem_id HAVING count(*) = 2 AND count(*) = (SELECT count(*) FROM problem_skills x WHERE x.problem_id = problem_skills.problem_id)
          ORDER BY problem_id LIMIT 1`);
      const { body } = await solve(user, await openInstance(user, id, 'linear-equations'));
      assert.deepEqual(body.awards.map((a: { skillId: string }) => a.skillId).sort(), ['arithmetic', 'linear-equations']);
    });

    test('rusty and revealed B to C restores at 1.5x', async () => {
      const user = await newUser();
      await setXp(user, 'expanding', xpForLevel(10), 30);
      const id = await openInstance(user, await pickProblem('B', 'expanding'), 'expanding');
      await revealAnswer(pool, user, id);
      assert.deepEqual((await solve(user, id)).body.awards, [{ skillId: 'expanding', xp: 375 }, { skillId: 'linear-equations', xp: 50 }]);
      assert.ok(Date.now() - (await lastPracticed(user, 'expanding')).getTime() < 60_000);
    });

    test('rusty and revealed C to D pays plain D and does not restore', async () => {
      const user = await newUser();
      await setXp(user, 'expanding', xpForLevel(10), 30);
      const before = await lastPracticed(user, 'expanding');
      const id = await openInstance(user, await pickProblem('C', 'expanding'), 'expanding');
      await revealAnswer(pool, user, id);
      assert.deepEqual((await solve(user, id)).body.awards, [{ skillId: 'expanding', xp: 50 }, { skillId: 'linear-equations', xp: 10 }]);
      assert.deepEqual(await lastPracticed(user, 'expanding'), before);
    });
  });

  describe('promotion', () => {
    test('a gate caps level while XP keeps growing', async () => {
      const user = await newUser();
      await setXp(user, 'expanding', xpForLevel(40));
      const id = (await call(nextProblem(pool, user, 'expanding'))).body;
      assert.equal(id.grade, 'B');
      await solve(user, id.instanceId);
      const skill = await skillOf(user, 'expanding');
      assert.equal(skill.xp, xpForLevel(40) + 1000);
      assert.equal(skill.level, 30);
      assert.deepEqual(skill.passedGates, []);
      assert.deepEqual(skill.promotion, { gate: 30, retryAt: null });
    });

    test('the capped level decides rust', async () => {
      const user = await newUser();
      // Uncapped this is level 70, with a 90 day limit. Capped at 30 the limit is 30 days.
      await setXp(user, 'expanding', xpForLevel(70), 40);
      assert.equal((await skillOf(user, 'expanding')).rusty, true);
    });

    test('below a gate there is no test', async () => {
      const user = await newUser();
      await setXp(user, 'expanding', xpForLevel(30) - 1);
      assert.equal((await skillOf(user, 'expanding')).promotion, null);
      const { status, body } = await call(startPromotion(pool, user, 'expanding'));
      assert.deepEqual([status, body], [409, { error: 'test_not_available' }]);
      assert.equal((await call(startPromotion(pool, user, 'nonsense'))).status, 404);
    });

    test('4 of 5 passes and jumps to what the XP supports, up to the next gate', async () => {
      const user = await newUser();
      await setXp(user, 'expanding', xpForLevel(70));
      const { body } = await call(startPromotion(pool, user, 'expanding'));
      assert.deepEqual(
        { ...body, problem: undefined },
        { kind: 'promotion', skillId: 'expanding', gate: 30, answered: 0, correct: 0, total: 5, passed: null, placedSkills: [], problem: undefined },
      );
      assert.equal(body.problem.grade, 'B');
      const done = await takeTest(user, body, 4);
      assert.deepEqual([done.passed, done.correct, done.answered, done.problem], [true, 4, 5, null]);
      const skill = await skillOf(user, 'expanding');
      assert.equal(skill.level, 60);
      assert.deepEqual(skill.passedGates, [30]);
      assert.deepEqual(skill.promotion, { gate: 60, retryAt: null });
      assert.equal((await call(nextProblem(pool, user, 'expanding'))).body.grade, 'A');
    });

    test('later gates test at grade A and S', async () => {
      const user = await newUser();
      await setXp(user, 'expanding', xpForLevel(95));
      const grades = [];
      for (const gate of [30, 60, 90]) {
        const { body } = await call(startPromotion(pool, user, 'expanding'));
        assert.equal(body.gate, gate);
        grades.push(body.problem.grade);
        assert.equal((await takeTest(user, body, 5)).passed, true);
      }
      assert.deepEqual(grades, ['B', 'A', 'S']);
      const skill = await skillOf(user, 'expanding');
      assert.equal(skill.level, 95);
      assert.equal(skill.promotion, null);
    });

    test('3 of 5 fails and blocks the gate for 24 hours', async () => {
      const user = await newUser();
      await setXp(user, 'expanding', xpForLevel(30));
      const started = await call(startPromotion(pool, user, 'expanding'));
      assert.equal((await takeTest(user, started.body, 3)).passed, false);

      const skill = await skillOf(user, 'expanding');
      assert.equal(skill.level, 30);
      assert.ok(new Date(skill.promotion.retryAt).getTime() > Date.now() + DAY_MS - 60_000);
      const blocked = await call(startPromotion(pool, user, 'expanding'));
      assert.equal(blocked.status, 409);
      assert.deepEqual(blocked.body, { error: 'test_cooling_down', retryAt: skill.promotion.retryAt });

      await pool.query(`UPDATE tests SET finished_at = finished_at - interval '23 hours' WHERE user_id = $1`, [user]);
      assert.equal((await call(startPromotion(pool, user, 'expanding'))).status, 409);
      await pool.query(`UPDATE tests SET finished_at = finished_at - interval '2 hours' WHERE user_id = $1`, [user]);
      assert.deepEqual((await skillOf(user, 'expanding')).promotion, { gate: 30, retryAt: null });
      assert.equal((await call(startPromotion(pool, user, 'expanding'))).status, 200);
    });

    test('test answers pay no XP and do not count as practice', async () => {
      const user = await newUser();
      await setXp(user, 'expanding', xpForLevel(30));
      const before = await lastPracticed(user, 'expanding');
      const { body } = await call(startPromotion(pool, user, 'expanding'));
      const first = await solve(user, body.problem.instanceId);
      assert.equal(first.body.correct, true);
      assert.deepEqual(first.body.awards, []);
      assert.equal(first.body.test.answered, 1);
      await takeTest(user, first.body.test, 5);
      assert.equal(await xpOf(user, 'expanding'), xpForLevel(30));
      assert.equal(await eventCount(user), 0);
      assert.deepEqual(await lastPracticed(user, 'expanding'), before);
    });

    test('an open test resumes, and only one test can be open', async () => {
      const user = await newUser();
      await setXp(user, 'expanding', xpForLevel(30));
      await setXp(user, 'factoring', xpForLevel(30));
      const started = await call(startPromotion(pool, user, 'expanding'));
      const answered = await solve(user, started.body.problem.instanceId);
      const resumed = await call(startPromotion(pool, user, 'expanding'));
      assert.deepEqual(resumed.body, answered.body.test);
      assert.deepEqual((await call(listSkills(pool, user))).body.openTest, { kind: 'promotion', skillId: 'expanding', gate: 30 });
      const other = await call(startPromotion(pool, user, 'factoring'));
      assert.deepEqual([other.status, other.body], [409, { error: 'test_open' }]);
      assert.deepEqual((await call(startPlacement(pool, user))).body, { error: 'test_open' });
    });

    test('a test problem never shows up in practice', async () => {
      const user = await newUser();
      await setXp(user, 'expanding', xpForLevel(30));
      await call(startPromotion(pool, user, 'expanding'));
      const { instanceId } = (await call(nextProblem(pool, user, 'expanding'))).body;
      const { rows } = await pool.query('SELECT test_id FROM problem_instances WHERE id = $1', [instanceId]);
      assert.equal(rows[0].test_id, null);
    });

    test('a problem in an open test cannot be drawn or answered in practice', async () => {
      const user = await newUser();
      await setXp(user, 'expanding', xpForLevel(30));
      const { body } = await call(startPromotion(pool, user, 'expanding'));
      const { rows: [{ problem_id }] } = await pool.query('SELECT problem_id FROM problem_instances WHERE id = $1', [body.problem.instanceId]);
      const earlier = await openInstance(user, problem_id, 'expanding');

      const refused = await call(submitAttempt(pool, user, earlier, await answerOf(earlier)));
      assert.deepEqual([refused.status, refused.body], [409, { error: 'test_open' }]);

      await pool.query(
        `INSERT INTO xp_events (user_id, skill_id, problem_id, amount)
         SELECT $1, 'expanding', ps.problem_id, 1 FROM problem_skills ps
          WHERE ps.skill_id = 'expanding' AND ps.problem_id NOT IN (
            SELECT problem_id FROM problem_instances WHERE user_id = $1 AND test_id IS NOT NULL)`, [user]);
      assert.deepEqual((await call(nextProblem(pool, user, 'expanding'))).body, { error: 'no_problems_left' });

      await takeTest(user, body, 5);
      assert.equal((await solve(user, earlier)).status, 200);
    });

    test('a retest prefers problems never solved, and a correct test answer counts as solved', async () => {
      const user = await newUser();
      await setXp(user, 'expanding', xpForLevel(30));
      const { rows } = await pool.query(
        `SELECT p.id FROM problems p JOIN problem_skills ps ON ps.problem_id = p.id
          WHERE p.grade = 'B' AND ps.skill_id = 'expanding' ORDER BY p.id`,
      );
      const bank: string[] = rows.map((r) => r.id);
      for (const id of bank.slice(0, -8)) await pool.query(
        `INSERT INTO xp_events (user_id, skill_id, problem_id, amount) VALUES ($1, 'expanding', $2, 1)`, [user, id]);

      const started = await call(startPromotion(pool, user, 'expanding'));
      assert.equal((await takeTest(user, started.body, 3)).passed, false);
      const solved = (await pool.query(
        `SELECT i.problem_id FROM problem_instances i JOIN attempts a ON a.instance_id = i.id WHERE i.user_id = $1 AND a.correct`, [user],
      )).rows.map((r) => r.problem_id);
      assert.equal(solved.length, 3);

      await pool.query(`UPDATE tests SET finished_at = finished_at - interval '25 hours' WHERE user_id = $1`, [user]);
      assert.equal((await call(startPromotion(pool, user, 'expanding'))).status, 200);
      const retest = (await pool.query(
        `SELECT i.problem_id FROM problem_instances i JOIN tests t ON t.id = i.test_id
          WHERE i.user_id = $1 AND t.finished_at IS NULL ORDER BY i.problem_id`, [user],
      )).rows.map((r) => r.problem_id);
      assert.deepEqual(retest, bank.slice(-8).filter((id) => !solved.includes(id)).sort());
    });

    test('repeating an answer brings the test back, so a lost response loses nothing', async () => {
      const user = await newUser();
      await setXp(user, 'expanding', xpForLevel(30));
      const { body } = await call(startPromotion(pool, user, 'expanding'));
      const id = body.problem.instanceId;
      const first = await solve(user, id);
      const repeat = await call(submitAttempt(pool, user, id, WRONG));
      assert.deepEqual([repeat.status, repeat.body], [409, { error: 'already_answered', test: first.body.test }]);

      const done = await takeTest(user, first.body.test, 5);
      assert.equal(done.passed, true);
      const final = await call(submitAttempt(pool, user, id, WRONG));
      assert.deepEqual([final.status, final.body], [409, { error: 'already_answered', test: done }]);
    });

    test('reveal is refused for test problems and while a test is open', async () => {
      const user = await newUser();
      await setXp(user, 'expanding', xpForLevel(30));
      const practice = await openInstance(user, await pickProblem('D', 'factoring'), 'factoring');
      const { body } = await call(startPromotion(pool, user, 'expanding'));
      const id = body.problem.instanceId;
      assert.deepEqual((await call(revealAnswer(pool, user, id))).body, { error: 'reveal_refused' });
      assert.equal((await call(revealAnswer(pool, user, practice))).status, 409);
      await takeTest(user, body, 0);
      assert.equal((await call(revealAnswer(pool, user, id))).status, 409);
    });

    test('a revealed problem is never used, a solved one only as a last resort', async () => {
      const user = await newUser();
      await setXp(user, 'expanding', xpForLevel(30));
      const { rows } = await pool.query(
        `SELECT p.id FROM problems p JOIN problem_skills ps ON ps.problem_id = p.id
          WHERE p.grade = 'B' AND ps.skill_id = 'expanding' ORDER BY p.id`,
      );
      const bank: string[] = rows.map((r) => r.id);
      const revealed = bank.slice(0, 5);
      const solved = bank.slice(5, 10);
      for (const id of revealed) await pool.query(
        `INSERT INTO problem_instances (user_id, problem_id, skill_id, revealed_at) VALUES ($1, $2, 'expanding', now())`, [user, id]);
      for (const id of solved) await pool.query(
        `INSERT INTO xp_events (user_id, skill_id, problem_id, amount) VALUES ($1, 'expanding', $2, 1)`, [user, id]);

      await call(startPromotion(pool, user, 'expanding'));
      const chosen = async () => (await pool.query(
        'SELECT problem_id FROM problem_instances WHERE user_id = $1 AND test_id IS NOT NULL', [user])).rows.map((r) => r.problem_id);
      const picked = await chosen();
      assert.equal(picked.length, 5);
      assert.ok(picked.every((id) => bank.slice(10).includes(id)));
    });

    test('too few at the wanted grade falls back to the nearest grade', async () => {
      const user = await newUser();
      await setXp(user, 'expanding', xpForLevel(30));
      const { rows } = await pool.query(
        `SELECT p.id FROM problems p JOIN problem_skills ps ON ps.problem_id = p.id
          WHERE p.grade = 'B' AND ps.skill_id = 'expanding' ORDER BY p.id OFFSET 3`,
      );
      for (const { id } of rows) await pool.query(
        `INSERT INTO problem_instances (user_id, problem_id, skill_id, revealed_at) VALUES ($1, $2, 'expanding', now())`, [user, id]);
      await call(startPromotion(pool, user, 'expanding'));
      const grades = await pool.query(
        `SELECT p.grade, count(*)::int AS n FROM problem_instances i JOIN problems p ON p.id = i.problem_id
          WHERE i.user_id = $1 AND i.test_id IS NOT NULL GROUP BY 1`, [user]);
      const count = Object.fromEntries(grades.rows.map((r) => [r.grade, r.n]));
      assert.equal(count.B, 3);
      assert.equal((count.A ?? 0) + (count.C ?? 0), 2);
    });

    test('a bank too small for the test refuses it and leaves nothing behind', async () => {
      const user = await newUser();
      await setXp(user, 'expanding', xpForLevel(30));
      await pool.query(
        `INSERT INTO problem_instances (user_id, problem_id, skill_id, revealed_at)
         SELECT $1, ps.problem_id, 'expanding', now() FROM problem_skills ps
          WHERE ps.skill_id = 'expanding' OFFSET 4`, [user]);
      assert.deepEqual((await call(startPromotion(pool, user, 'expanding'))).body, { error: 'no_problems_left' });
      assert.equal((await pool.query('SELECT 1 FROM tests WHERE user_id = $1', [user])).rowCount, 0);
    });
  });

  describe('placement', () => {
    test('grants exactly xpForLevel(30), prerequisites included without being asked', async () => {
      const user = await newUser();
      assert.equal((await call(listSkills(pool, user))).body.placementAvailable, true);
      // Factoring and everything under it: some of these are placed by inference, never probed.
      const placed = ['arithmetic', 'expanding', 'factoring', 'linear-equations'];
      const { test: done, probed } = await takePlacement(user, placed);
      assert.equal(done.passed, true);
      assert.deepEqual(done.placedSkills, placed);
      assert.ok(placed.some((skill) => !probed.has(skill)));

      for (const skill of placed) {
        assert.equal(await xpOf(user, skill), xpForLevel(30));
        assert.ok(Date.now() - (await lastPracticed(user, skill)).getTime() < 60_000);
      }
      for (const skill of ['function-values', 'sequences', 'derivatives', 'partial-derivatives']) assert.equal(await xpOf(user, skill), 0);
      const { rows } = await pool.query(`SELECT skill_id, amount, reason, problem_id FROM xp_events WHERE user_id = $1 ORDER BY skill_id`, [user]);
      assert.deepEqual(rows, placed.map((skill_id) =>
        ({ skill_id, amount: xpForLevel(30), reason: 'placement', problem_id: null })));
      const skill = await skillOf(user, 'factoring');
      assert.equal(skill.level, 30);
      assert.deepEqual(skill.promotion, { gate: 30, retryAt: null });
    });

    test('grants no more than Lv 30 even when everything passes', async () => {
      const user = await newUser();
      const all = (await pool.query('SELECT id FROM skills')).rows.map((r) => r.id);
      const { test: done } = await takePlacement(user, all);
      assert.equal(done.placedSkills.length, all.length);
      assert.ok(done.answered < 20);
      const { skills } = (await call(listSkills(pool, user))).body;
      assert.ok(skills.every((s: { xp: number }) => s.xp === xpForLevel(30)));
    });

    test('probes are grade B and two per skill', async () => {
      const user = await newUser();
      await takePlacement(user, ['factoring']);
      const { rows } = await pool.query(
        `SELECT i.skill_id, count(*)::int AS n, min(p.grade) AS low, max(p.grade) AS high
           FROM problem_instances i JOIN problems p ON p.id = i.problem_id
          WHERE i.user_id = $1 GROUP BY 1`, [user]);
      assert.ok(rows.length > 1);
      for (const r of rows) assert.deepEqual([r.n, r.low, r.high], [2, 'B', 'B']);
    });

    test('refused after any XP', async () => {
      const user = await newUser();
      await solve(user, await openInstance(user, await pickProblem('D', 'expanding'), 'expanding'));
      assert.equal((await call(listSkills(pool, user))).body.placementAvailable, false);
      const { status, body } = await call(startPlacement(pool, user));
      assert.deepEqual([status, body], [409, { error: 'placement_unavailable' }]);
    });

    test('refused the second time, even when nothing passed', async () => {
      const user = await newUser();
      const { test: done } = await takePlacement(user, []);
      assert.deepEqual([done.passed, done.placedSkills], [false, []]);
      assert.equal(await eventCount(user), 0);
      assert.equal((await call(listSkills(pool, user))).body.placementAvailable, false);
      assert.equal((await call(startPlacement(pool, user))).status, 409);
    });

    test('a player can leave and resume', async () => {
      const user = await newUser();
      const first = (await call(startPlacement(pool, user))).body;
      assert.deepEqual((await call(startPlacement(pool, user))).body, first);
      const answered = (await solve(user, first.problem.instanceId)).body.test;
      assert.deepEqual((await call(startPlacement(pool, user))).body, answered);
      assert.deepEqual((await call(listSkills(pool, user))).body.openTest, { kind: 'placement', skillId: null, gate: null });
    });

    test('repeating an answer after it ended still names the placed skills', async () => {
      const user = await newUser();
      const { test: done } = await takePlacement(user, ['factoring']);
      const { rows: [{ id }] } = await pool.query('SELECT id FROM problem_instances WHERE user_id = $1 LIMIT 1', [user]);
      const repeat = await call(submitAttempt(pool, user, id, WRONG));
      assert.deepEqual([repeat.status, repeat.body], [409, { error: 'already_answered', test: done }]);
    });

    test('practice, reveal and XP are refused while it is open', async () => {
      const user = await newUser();
      const practice = await openInstance(user, await pickProblem('D', 'expanding'), 'expanding');
      const { body } = await call(startPlacement(pool, user));
      assert.deepEqual((await call(nextProblem(pool, user, 'expanding'))).body, { error: 'test_open' });
      assert.deepEqual((await solve(user, practice)).body, { error: 'test_open' });
      assert.deepEqual((await call(revealAnswer(pool, user, body.problem.instanceId))).body, { error: 'reveal_refused' });
      assert.equal((await call(revealAnswer(pool, user, practice))).status, 409);
      assert.equal(await eventCount(user), 0);
      assert.equal((await pool.query('SELECT 1 FROM attempts WHERE user_id = $1', [user])).rowCount, 0);
    });

    test('a skill with no usable problems is not probed and does not pass by itself', async () => {
      const user = await newUser();
      await pool.query(
        `INSERT INTO problem_instances (user_id, problem_id, skill_id, revealed_at)
         SELECT $1, ps.problem_id, 'factoring', now() FROM problem_skills ps WHERE ps.skill_id = 'factoring'`, [user]);
      const { test: done, probed } = await takePlacement(user, ['linear-equations', 'expanding', 'function-values']);
      assert.ok(!probed.has('factoring'));
      assert.deepEqual(done.placedSkills, ['arithmetic', 'expanding', 'function-values', 'linear-equations']);
    });
  });

  describe('safety', () => {
    test('double submit pays once and the second gets a conflict', async () => {
      const user = await newUser();
      const id = await openInstance(user, await pickProblem('D', 'expanding'), 'expanding');
      const answer = await answerOf(id);
      const both = await Promise.all([1, 2].map(() => call(submitAttempt(pool, user, id, answer))));
      assert.deepEqual(both.map((r) => r.status).sort(), [200, 409]);
      assert.equal(await xpOf(user, 'expanding'), 50);
      assert.equal(await xpOf(user, 'linear-equations'), 10);
      assert.equal(await eventCount(user), 2);
    });

    test('a parallel burst cannot pass the attempt limit', async () => {
      const user = await newUser();
      const problem = await pickProblem('D', 'expanding');
      const ids = await Promise.all(Array.from({ length: 35 }, () => openInstance(user, problem, 'expanding')));
      const burst = await Promise.all(ids.map((id) => call(submitAttempt(pool, user, id, WRONG))));
      assert.equal(burst.filter((r) => r.status === 200).length, 30);
      assert.equal(burst.filter((r) => r.status === 429).length, 5);
    });

    test('parallel next calls open one problem', async () => {
      const user = await newUser();
      const all = await Promise.all(Array.from({ length: 10 }, () => call(nextProblem(pool, user, 'expanding'))));
      assert.equal(new Set(all.map((r) => r.body.instanceId)).size, 1);
    });

    test('one problem on two instances pays once', async () => {
      const user = await newUser();
      const problem = await pickProblem('D', 'expanding');
      await solve(user, await openInstance(user, problem, 'expanding'));
      assert.deepEqual((await solve(user, await openInstance(user, problem, 'expanding'))).body.awards, []);
      assert.equal(await xpOf(user, 'expanding'), 50);
    });

    test('a problem paid through another skill does not come back open', async () => {
      const user = await newUser();
      const problem = await pickProblem('A', 'derivatives');
      const { rows } = await pool.query('SELECT skill_id FROM problem_skills WHERE problem_id = $1 ORDER BY skill_id', [problem]);
      const [first, second] = rows.map((r) => r.skill_id);
      const paid = await openInstance(user, problem, first);
      const stale = await openInstance(user, problem, second);
      assert.equal((await solve(user, paid)).body.awards.filter((a: { skillId: string }) => rows.some((r) => r.skill_id === a.skillId)).length, 2);

      const next = (await call(nextProblem(pool, user, second))).body;
      assert.ok(next.instanceId);
      assert.notEqual(next.instanceId, stale);
    });

    test('another user cannot answer an instance', async () => {
      const user = await newUser();
      const id = await openInstance(user, await pickProblem('D', 'expanding'), 'expanding');
      assert.equal((await call(submitAttempt(pool, await newUser(), id, '1'))).status, 404);
    });

    test('running out at the wanted grade falls back to the nearest grade', async () => {
      const user = await newUser();
      await pool.query(
        `INSERT INTO xp_events (user_id, skill_id, problem_id, amount)
         SELECT $1, 'expanding', ps.problem_id, 1 FROM problem_skills ps JOIN problems p ON p.id = ps.problem_id
          WHERE ps.skill_id = 'expanding' AND p.grade = 'D'`, [user]);
      assert.equal((await call(nextProblem(pool, user, 'expanding'))).body.grade, 'C');
    });

    test('anonymous visitors see plain skills and no test state', async () => {
      const { body } = await call(listSkills(pool, undefined));
      assert.equal(body.skills.length, (await pool.query('SELECT 1 FROM skills')).rowCount);
      assert.equal(body.placementAvailable, false);
      assert.equal(body.openTest, null);
      assert.deepEqual(
        { level: body.skills[0].level, passedGates: body.skills[0].passedGates, promotion: body.skills[0].promotion, rusty: body.skills[0].rusty },
        { level: 1, passedGates: [], promotion: null, rusty: false },
      );
    });

    test('requests are checked before any rule runs', async () => {
      const user = await newUser();
      const instanceId = (await call(nextProblem(pool, user, 'expanding'))).body.instanceId;
      const cases: [string, unknown, number][] = [
        ['/api/problems/next', { skillId: 'a\0b' }, 400],
        ['/api/tests/promotion', { skillId: 'a\0b' }, 400],
        ['/api/attempts', { instanceId, answer: 'a\0b' }, 400],
        ['/api/attempts', { instanceId, answer: '1'.repeat(201) }, 400],
        ['/api/attempts', { instanceId: 'nope', answer: '1' }, 400],
        ['/api/attempts', { instanceId, answer: '1'.repeat(5000) }, 400],
        ['/api/attempts', [instanceId], 400],
        ['/api/nothing', {}, 404],
        ['/api/auth/dev', {}, 404],
      ];
      for (const [path, body, status] of cases) assert.equal((await call(api(user, path, body))).status, status, path);
      assert.equal((await call(api(undefined, '/api/problems/next', { skillId: 'expanding' }))).status, 401);
      assert.equal((await call(api(user, '/api/attempts', { instanceId, answer: '1' }, 'https://evil.example'))).status, 403);
      assert.equal((await api(user, '/api/auth/google')).status, 404);
    });

    test('an expired or signed-out session is no session', async () => {
      const user = await newUser();
      assert.equal((await call(listSkills(pool, user))).body.signedIn, true);
      await pool.query(`UPDATE session SET "expiresAt" = now() - interval '1 second' WHERE "userId" = $1`, [user]);
      assert.equal((await call(listSkills(pool, user))).body.signedIn, false);

      const other = await newUser();
      const out = await api(other, '/api/auth/sign-out', {});
      assert.match(out.headers.get('set-cookie') ?? '', /^session=; .*Max-Age=0/);
      assert.equal((await call(listSkills(pool, other))).body.signedIn, false);
    });

    // Runs last. Everything above went through call(), except the successful reveals.
    test('no API response other than reveal contains the answer', async () => {
      assert.ok(seen.length > 100);
      const answerOfSome = await pool.query(
        'SELECT i.id, p.answer_latex FROM problem_instances i JOIN problems p ON p.id = i.problem_id WHERE i.user_id = ANY($1)',
        [users],
      );
      const answers = new Map<string, string>(answerOfSome.rows.map((r) => [r.id, r.answer_latex]));
      let checked = 0;
      const walk = (value: unknown, text: string) => {
        if (value === null || typeof value !== 'object') return;
        for (const [key, inner] of Object.entries(value)) {
          assert.doesNotMatch(key, /^answer($|_|latex)/i);
          // Short answers like 2 also appear in ordinary numbers, so only longer ones can be searched for.
          const answer = key === 'instanceId' ? answers.get(inner as string) : undefined;
          if (answer !== undefined && answer.length > 3) {
            checked++;
            assert.ok(!text.includes(answer), answer);
          }
          walk(inner, text);
        }
      };
      for (const { body, text } of seen) walk(body, text);
      assert.ok(checked > 20);
    });
  });
});
