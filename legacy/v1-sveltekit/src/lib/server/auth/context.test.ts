import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const saved = { ...process.env };

beforeAll(() => {
  process.env.SREP_DATABASE_URL = 'sqlite::memory:';
  process.env.SREP_ORIGIN = 'https://srep.example.com';
  process.env.SREP_LOG_LEVEL = 'silent';
});

afterAll(async () => {
  const { getDb } = await import('#lib/server/db/index.js');
  await getDb().close();
  process.env = saved;
});

describe('getAuthContext', () => {
  it('builds the production deps from the config once', async () => {
    const { getAuthContext } = await import('#lib/server/auth/context.js');
    const context = getAuthContext();
    expect(context).toBe(getAuthContext());
    expect(context.deps.auth.origin).toBe('https://srep.example.com');
    expect(context.deps.auth.secureCookies).toBe(true);
    expect(context.deps.random(8)).toHaveLength(8);
    expect(typeof context.deps.now()).toBe('number');
    expect(context.limiters.authAttempts.check('x').allowed).toBe(true);
  });
});
