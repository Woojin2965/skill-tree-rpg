import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Pool } from 'pg';
import worker from './index.ts';

// Needs scripts/db.sh start and reset. Goes through the real fetch handler and removes its user at the end.
const connectionString = 'postgres://postgres@localhost:5433/knowledge_rpg';
const pool = new Pool({ connectionString, max: 1 });
const ready = await pool.query('SELECT 1 FROM problems LIMIT 1').then((r) => r.rowCount === 1, () => false);
const email = `index-test-${crypto.randomUUID()}@example.test`;

const env = {
  HYPERDRIVE: { connectionString },
  BETTER_AUTH_SECRET: crypto.randomUUID() + crypto.randomUUID(),
  BETTER_AUTH_URL: 'http://localhost',
  DEV_PASSWORD_LOGIN: '1',
} as unknown as Env;
const ctx = { waitUntil() {} } as unknown as ExecutionContext;

function post(path: string, body: unknown, cookie = '') {
  const text = JSON.stringify(body);
  const headers = { 'content-type': 'application/json', 'content-length': String(text.length), cookie, origin: 'http://localhost' };
  return worker.fetch!(new Request(`http://localhost${path}`, { method: 'POST', headers, body: text }) as never, env, ctx);
}

after(async () => {
  if (ready) await pool.query('DELETE FROM "user" WHERE email = $1', [email]);
  await pool.end();
});

test('NUL in a string is a bad request, not a server error', { skip: !ready && 'local database is not running' }, async () => {
  const signedUp = await post('/api/auth/sign-up/email', { email, password: 'index-test-password', name: 'test' });
  const cookie = signedUp.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const { instanceId } = await (await post('/api/problems/next', { skillId: 'expanding' }, cookie)).json() as { instanceId: string };
  assert.ok(instanceId);

  for (const [path, body] of [
    ['/api/problems/next', { skillId: 'a\0b' }],
    ['/api/tests/promotion', { skillId: 'a\0b' }],
    ['/api/attempts', { instanceId, answer: 'a\0b' }],
  ] as const) {
    const response = await post(path, body, cookie);
    assert.equal(response.status, 400, path);
    assert.deepEqual(await response.json(), { error: 'bad_request' });
  }
});
