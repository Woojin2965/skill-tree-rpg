import { Pool } from 'pg';
import { makeAuth } from './auth.ts';
import { json, listSkills, nextProblem, revealAnswer, startPlacement, startPromotion, submitAttempt } from './game.ts';

const MAX_BODY_BYTES = 2048;
const MAX_ANSWER_LENGTH = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const POST_ROUTES = new Set([
  'POST /api/problems/next',
  'POST /api/problems/reveal',
  'POST /api/attempts',
  'POST /api/tests/promotion',
  'POST /api/tests/placement',
]);

// Postgres text cannot hold NUL, so one would surface as a server error.
const isText = (value: unknown): value is string => typeof value === 'string' && !value.includes('\0');

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const length = Number(request.headers.get('content-length'));
  if (!length || length > MAX_BODY_BYTES) return null;
  try {
    const body = await request.json();
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function route(request: Request, env: Env, pool: Pool) {
  const { pathname } = new URL(request.url);
  const auth = makeAuth(env, pool);
  if (pathname.startsWith('/api/auth/')) return auth.handler(request);

  const session = await auth.api.getSession({ headers: request.headers });
  const userId = session?.user.id;
  const route = `${request.method} ${pathname}`;

  if (route === 'GET /api/skills') return listSkills(pool, userId);
  if (!POST_ROUTES.has(route)) return json({ error: 'not_found' }, 404);
  if (!userId) return json({ error: 'sign_in_required' }, 401);

  const body = await readBody(request);
  if (!body) return json({ error: 'bad_request' }, 400);

  if (route === 'POST /api/tests/placement') return startPlacement(pool, userId);

  const { skillId, instanceId, answer } = body;
  if (route === 'POST /api/problems/next' || route === 'POST /api/tests/promotion') {
    if (!isText(skillId)) return json({ error: 'bad_request' }, 400);
    return route === 'POST /api/problems/next' ? nextProblem(pool, userId, skillId) : startPromotion(pool, userId, skillId);
  }
  if (typeof instanceId !== 'string' || !UUID.test(instanceId)) return json({ error: 'bad_request' }, 400);
  if (route === 'POST /api/problems/reveal') return revealAnswer(pool, userId, instanceId);
  if (!isText(answer) || answer.length > MAX_ANSWER_LENGTH) return json({ error: 'bad_request' }, 400);
  return submitAttempt(pool, userId, instanceId, answer);
}

export default {
  async fetch(request, env, ctx) {
    // Hyperdrive does the real pooling. This pool lives for one request.
    const pool = new Pool({ connectionString: env.HYPERDRIVE.connectionString, max: 2 });
    try {
      return await route(request, env, pool);
    } catch (error) {
      console.error(JSON.stringify({ message: 'request failed', path: new URL(request.url).pathname, error: String(error) }));
      return json({ error: 'server_error' }, 500);
    } finally {
      ctx.waitUntil(pool.end());
    }
  },
} satisfies ExportedHandler<Env>;
