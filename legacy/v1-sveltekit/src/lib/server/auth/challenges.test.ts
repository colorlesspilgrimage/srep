import { afterEach, describe, expect, it } from 'vitest';
import { CHALLENGE_TTL_MS, createChallenge, takeChallenge } from '#lib/server/auth/challenges.js';
import { createHarness, type Harness } from '#lib/server/auth/test-support/harness.js';

let h: Harness;
afterEach(async () => {
  await h.handle.close();
});

describe('challenges', () => {
  it('works once', async () => {
    h = await createHarness();
    const id = await createChallenge(h.deps, 'login', 'abc');
    expect(await takeChallenge(h.deps, id, 'login')).toEqual({ ok: true, challenge: 'abc' });
    expect(await takeChallenge(h.deps, id, 'login')).toMatchObject({
      ok: false,
      status: 400,
      error: 'challenge_invalid',
    });
  });

  it('rejects an unknown id', async () => {
    h = await createHarness();
    expect(await takeChallenge(h.deps, 'nope', 'login')).toMatchObject({
      error: 'challenge_invalid',
    });
  });

  it('rejects the wrong purpose and uses the row up', async () => {
    h = await createHarness();
    const id = await createChallenge(h.deps, 'login', 'abc');
    expect(await takeChallenge(h.deps, id, 'setup')).toMatchObject({ error: 'challenge_invalid' });
    expect(await takeChallenge(h.deps, id, 'login')).toMatchObject({ error: 'challenge_invalid' });
  });

  it('is valid one millisecond before expiry and expired at expiry', async () => {
    h = await createHarness();
    const early = await createChallenge(h.deps, 'login', 'a');
    h.clock.now += CHALLENGE_TTL_MS - 1;
    expect((await takeChallenge(h.deps, early, 'login')).ok).toBe(true);
    const late = await createChallenge(h.deps, 'login', 'b');
    h.clock.now += CHALLENGE_TTL_MS;
    expect(await takeChallenge(h.deps, late, 'login')).toMatchObject({
      status: 400,
      error: 'challenge_expired',
    });
  });

  it('prunes expired rows when it creates a new one', async () => {
    h = await createHarness();
    const old = await createChallenge(h.deps, 'login', 'a');
    h.clock.now += CHALLENGE_TTL_MS + 1;
    await createChallenge(h.deps, 'login', 'b');
    expect(await h.store.consumeChallenge(old)).toBeUndefined();
  });
});
