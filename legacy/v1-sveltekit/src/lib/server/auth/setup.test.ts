import { afterEach, describe, expect, it } from 'vitest';
import { CHALLENGE_TTL_MS } from '#lib/server/auth/challenges.js';
import { sha256Hex } from '#lib/server/auth/tokens.js';
import {
  SETUP_RESPONSE,
  createHarness,
  doSetup,
  type Harness,
} from '#lib/server/auth/test-support/harness.js';
import { ensureSetupToken, setupOptions, setupVerify } from '#lib/server/auth/setup.js';

let h: Harness;
afterEach(async () => {
  await h.handle.close();
});

const input = { kind: 'passkey', nickname: 'Laptop' } as const;

function verifyInput(token: string, challengeId: string) {
  return {
    setupToken: token,
    challengeId,
    response: SETUP_RESPONSE,
    userAgent: 'ua',
    ...input,
  };
}

describe('ensureSetupToken', () => {
  it('returns a token and stores only its hash', async () => {
    h = await createHarness();
    const token = await ensureSetupToken(h.deps);
    expect(token).not.toBeNull();
    expect(await h.store.getSetupTokenHash()).toBe(sha256Hex(token ?? ''));
    const rows =
      h.handle.dialect === 'sqlite' ? h.handle.db.all('select value from app_settings') : [];
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('returns null after setup', async () => {
    h = await createHarness();
    await doSetup(h);
    expect(await ensureSetupToken(h.deps)).toBeNull();
  });

  it('makes a new token on each start while setup is open', async () => {
    h = await createHarness();
    const first = await ensureSetupToken(h.deps);
    const second = await ensureSetupToken(h.deps);
    expect(first).not.toBe(second);
    expect(await setupOptions(h.deps, { setupToken: first ?? '', ...input })).toMatchObject({
      error: 'setup_token_invalid',
    });
  });
});

describe('setupOptions', () => {
  it.each([['wrong'], ['']])('rejects the token %j', async (token) => {
    h = await createHarness();
    await ensureSetupToken(h.deps);
    expect(await setupOptions(h.deps, { setupToken: token, ...input })).toMatchObject({
      ok: false,
      status: 403,
      error: 'setup_token_invalid',
    });
  });

  it('rejects any token when setup was never armed', async () => {
    h = await createHarness();
    expect(await setupOptions(h.deps, { setupToken: 'x', ...input })).toMatchObject({
      error: 'setup_token_invalid',
    });
  });

  it('rejects a bad nickname', async () => {
    h = await createHarness();
    const token = (await ensureSetupToken(h.deps)) ?? '';
    expect(
      await setupOptions(h.deps, { setupToken: token, kind: 'passkey', nickname: ' ' }),
    ).toMatchObject({
      status: 400,
      error: 'invalid_nickname',
    });
  });
});

describe('setupVerify', () => {
  it('completes setup with 10 recovery codes and a session', async () => {
    h = await createHarness();
    const done = await doSetup(h);
    expect(done.recoveryCodes).toHaveLength(10);
    expect(done.sessionToken.length).toBeGreaterThan(20);
    expect(done.credential.nickname).toBe('Laptop');
    expect(JSON.stringify(done.credential)).not.toContain('publicKey');
    expect(await h.store.isSetupComplete()).toBe(true);
    expect(await h.store.listUnusedRecovery()).toHaveLength(10);
    const stored = JSON.stringify(await h.store.listUnusedRecovery());
    for (const code of done.recoveryCodes) {
      expect(stored).not.toContain(code);
    }
  });

  it('locks setup for options and verify after completion', async () => {
    h = await createHarness();
    const done = await doSetup(h);
    expect(await setupOptions(h.deps, { setupToken: done.setupToken, ...input })).toMatchObject({
      status: 403,
      error: 'setup_locked',
    });
    expect(await setupVerify(h.deps, verifyInput(done.setupToken, 'x'))).toMatchObject({
      status: 403,
      error: 'setup_locked',
    });
  });

  it('refuses to reuse a challenge', async () => {
    h = await createHarness();
    const token = (await ensureSetupToken(h.deps)) ?? '';
    const options = await setupOptions(h.deps, { setupToken: token, ...input });
    if (!options.ok) throw new Error('options');
    h.webauthn.registration = 'fail';
    expect((await setupVerify(h.deps, verifyInput(token, options.challengeId))).ok).toBe(false);
    h.webauthn.registration = {
      credentialId: 'c1',
      publicKey: 'pk',
      signCount: 0,
      transports: [],
    };
    expect(await setupVerify(h.deps, verifyInput(token, options.challengeId))).toMatchObject({
      error: 'challenge_invalid',
    });
  });

  it('refuses a challenge of another purpose', async () => {
    h = await createHarness();
    const token = (await ensureSetupToken(h.deps)) ?? '';
    await h.store.insertChallenge({
      id: 'c-login',
      challenge: 'x',
      purpose: 'login',
      expiresAt: h.clock.now + 1000,
    });
    expect(await setupVerify(h.deps, verifyInput(token, 'c-login'))).toMatchObject({
      error: 'challenge_invalid',
    });
  });

  it('refuses an expired challenge', async () => {
    h = await createHarness();
    const token = (await ensureSetupToken(h.deps)) ?? '';
    const options = await setupOptions(h.deps, { setupToken: token, ...input });
    if (!options.ok) throw new Error('options');
    h.clock.now += CHALLENGE_TTL_MS;
    expect(await setupVerify(h.deps, verifyInput(token, options.challengeId))).toMatchObject({
      error: 'challenge_expired',
    });
  });

  it('gives verification_failed and logs without the response', async () => {
    h = await createHarness();
    const token = (await ensureSetupToken(h.deps)) ?? '';
    const options = await setupOptions(h.deps, { setupToken: token, ...input });
    if (!options.ok) throw new Error('options');
    h.webauthn.registration = 'fail';
    expect(await setupVerify(h.deps, verifyInput(token, options.challengeId))).toMatchObject({
      status: 400,
      error: 'verification_failed',
    });
    expect(h.warnings).toHaveLength(1);
    expect(JSON.stringify(h.warnings)).not.toContain('credentialId');
    expect(await h.store.isSetupComplete()).toBe(false);
  });

  it('checks the token again at verify', async () => {
    h = await createHarness();
    await ensureSetupToken(h.deps);
    expect(await setupVerify(h.deps, verifyInput('wrong', 'x'))).toMatchObject({
      error: 'setup_token_invalid',
    });
  });

  it('refuses a bad nickname at verify', async () => {
    h = await createHarness();
    const token = (await ensureSetupToken(h.deps)) ?? '';
    expect(
      await setupVerify(h.deps, { ...verifyInput(token, 'x'), nickname: 'a\nb' }),
    ).toMatchObject({ error: 'invalid_nickname' });
  });

  it('stops the second of two setups that share a token', async () => {
    h = await createHarness();
    const token = (await ensureSetupToken(h.deps)) ?? '';
    const a = await setupOptions(h.deps, { setupToken: token, ...input });
    const b = await setupOptions(h.deps, { setupToken: token, ...input });
    if (!a.ok || !b.ok) throw new Error('options');
    const first = await setupVerify(h.deps, verifyInput(token, a.challengeId));
    const second = await setupVerify(h.deps, verifyInput(token, b.challengeId));
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ error: 'setup_locked' });
  });
});
