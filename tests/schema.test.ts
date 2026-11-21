import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from 'pg';

// Needs scripts/db.sh start and reset. Every row is rolled back.
test('rules schema stops double payment and keeps account deletion working', async (t) => {
  const db = new Client({ connectionString: 'postgres://postgres@localhost:5433/knowledge_rpg' });
  try {
    await db.connect();
  } catch {
    return t.skip('local database is not running');
  }
  const rejected = async (sql: string, params: unknown[] = []) => {
    await db.query('SAVEPOINT s');
    await assert.rejects(db.query(sql, params), sql);
    await db.query('ROLLBACK TO s');
  };

  try {
    await db.query('BEGIN');
    await db.query(`INSERT INTO "user" (id, name, email, "emailVerified") VALUES ('u', 'u', 'u@test', true)`);
    const account = `INSERT INTO account (id, "accountId", "providerId", "userId", "updatedAt") VALUES ($1, 'a1', 'google', 'u', now())`;
    await db.query(account, ['one']);
    await rejected(account, ['two']);
    const { rows } = await db.query('SELECT problem_id FROM problem_skills LIMIT 1');
    const problem = rows[0].problem_id;
    const pay = `INSERT INTO xp_events (user_id, skill_id, problem_id, amount) VALUES ('u', 'expanding', $1, 50)`;
    const place = `INSERT INTO xp_events (user_id, skill_id, amount, reason) VALUES ('u', 'expanding', 13363, 'placement')`;

    await db.query(pay, [problem]);
    await rejected(pay, [problem]);
    await db.query(place);
    await rejected(place);
    await rejected(`INSERT INTO xp_events (user_id, skill_id, amount) VALUES ('u', 'factoring', 50)`);
    await rejected(`INSERT INTO xp_events (user_id, skill_id, problem_id, amount, reason) VALUES ('u', 'factoring', $1, 50, 'placement')`, [problem]);
    await rejected(`UPDATE xp_events SET amount = 1 WHERE user_id = 'u'`);

    const open = `INSERT INTO tests (user_id, kind, skill_id, gate) VALUES ('u', 'promotion', 'expanding', 30) RETURNING id`;
    const placement = `INSERT INTO tests (user_id, kind) VALUES ('u', 'placement')`;
    const test1 = (await db.query(open)).rows[0].id;
    await rejected(open);
    await rejected(placement);
    await rejected(`UPDATE tests SET passed = false WHERE id = $1`, [test1]);
    await db.query(`UPDATE tests SET passed = false, finished_at = now() WHERE id = $1`, [test1]);
    await db.query(open);
    await db.query(`UPDATE tests SET passed = true, finished_at = now() WHERE finished_at IS NULL`);
    await db.query(placement);
    await db.query(`UPDATE tests SET passed = true, finished_at = now() WHERE finished_at IS NULL`);
    await rejected(placement);
    await rejected(`INSERT INTO tests (user_id, kind) VALUES ('u', 'promotion')`);
    await rejected(`INSERT INTO tests (user_id, kind, skill_id, gate) VALUES ('u', 'placement', 'expanding', 30)`);

    const instance = `INSERT INTO problem_instances (user_id, problem_id, skill_id, test_id, revealed_at)
                      VALUES ('u', $1, 'expanding', $2, $3) RETURNING id`;
    await rejected(instance, [problem, test1, new Date()]);
    const testInstance = (await db.query(instance, [problem, test1, null])).rows[0].id;
    await db.query(instance, [problem, null, new Date()]);
    await db.query(`INSERT INTO attempts (instance_id, user_id, answer, correct) VALUES ($1, 'u', '1', false)`, [testInstance]);

    await db.query(`DELETE FROM "user" WHERE id = 'u'`);
    for (const table of ['xp_events', 'tests', 'problem_instances', 'attempts']) {
      const left = await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE user_id = 'u'`);
      assert.equal(left.rows[0].n, 0, table);
    }
  } finally {
    await db.query('ROLLBACK').catch(() => {});
    await db.end();
  }
});
