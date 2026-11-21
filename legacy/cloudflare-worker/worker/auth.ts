import { betterAuth } from 'better-auth';
import type { Pool } from 'pg';

export function makeAuth(env: Env, pool: Pool) {
  return betterAuth({
    database: pool,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    // Local test accounts only: production signs in with Google or LINE.
    emailAndPassword: { enabled: env.DEV_PASSWORD_LOGIN === '1' },
    socialProviders: {
      ...(env.GOOGLE_CLIENT_ID && {
        google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
      }),
      ...(env.LINE_CLIENT_ID && {
        line: { clientId: env.LINE_CLIENT_ID, clientSecret: env.LINE_CLIENT_SECRET },
      }),
    },
  });
}
