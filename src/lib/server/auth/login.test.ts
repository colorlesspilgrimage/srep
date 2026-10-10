import { afterEach, describe, expect, it } from 'vitest';
import { CHALLENGE_TTL_MS } from '#lib/server/auth/challenges.js';
import { loginOptions, loginVerify } from '#lib/server/auth/login.js';
import { createHarness, doSetup, type Harness } from '#lib/server/auth/test-support/harness.js';
import { sha256Hex } from '#lib/server/auth/tokens.js';

let h: Harness;
afterEach(async () => {
  await h.handle.close();
});

const response = (id: string) => ({ id }) as never;

async function begin(kind: 'passkey' | 'security_key' = 'passkey') {
  const options = await loginOptions(h.deps, { kind });
  if (!options.ok) throw new Error(options.error);
  return options;
}

describe('loginOptions', () => {
  it('needs setup first', async () => {
    h = await createHarness();
    expect(await loginOptions(h.deps, { kind: 'passkey' })).toMatchObject({
      status: 403,
      error: 'setup_required',
    });
  });

  it('gives discoverable options for a passkey', async () => {
    h = await createHarness();
    await doSetup(h);
    await begin('passkey');
    expect(h.webauthn.lastAllow).toBeUndefined();
  });

  it('lists only security keys for a security key login', async () => {
    h = await createHarness();
    await doSetup(h);
    await h.store.insertCredential({
      id: 'k1',
      credentialId: 'key-1',
      publicKey: 'pk',
      signCount: 0,
      transports: ['usb'],
      kind: 'security_key',
      nickname: 'Key',
      createdAt: 1,
      lastUsedAt: null,
    });
    await begin('security_key');
    expect(h.webauthn.lastAllow).toEqual([{ credentialId: 'key-1', transports: ['usb'] }]);
  });

  it('returns no_security_key when there is none', async () => {
    h = await createHarness();
    await doSetup(h);
    expect(await loginOptions(h.deps, { kind: 'security_key' })).toMatchObject({
      status: 400,
      error: 'no_security_key',
    });
  });
});

describe('loginVerify', () => {
  it('logs in, updates the counter and the last use time', async () => {
    h = await createHarness();
    await doSetup(h);
    const options = await begin();
    h.clock.now += 5000;
    h.webauthn.authentication = { newSignCount: 4 };
    const result = await loginVerify(h.deps, {
      challengeId: options.challengeId,
      response: response('cred-default'),
      userAgent: 'ua',
    });
    expect(result.ok).toBe(true);
    const row = await h.store.getCredentialByCredentialId('cred-default');
    expect(row?.signCount).toBe(4);
    expect(row?.lastUsedAt).toBe(h.clock.now);
    const token = result.ok ? result.sessionToken : '';
    expect(await h.store.getSessionByTokenHash(sha256Hex(token))).toBeDefined();
    expect(h.webauthn.verifiedWith.at(-1)).toBe(options.options.challenge);
  });

  it('gives the same 401 for an unknown credential, a bad signature and a replay', async () => {
    h = await createHarness();
    await doSetup(h);
    const results = [];
    for (const [id, mode] of [
      ['unknown', 'ok'],
      ['cred-default', 'fail'],
      ['cred-default', 'replay'],
    ] as const) {
      const options = await begin();
      h.webauthn.authentication = mode === 'ok' ? { newSignCount: 1 } : mode;
      results.push(
        await loginVerify(h.deps, {
          challengeId: options.challengeId,
          response: response(id),
          userAgent: 'ua',
        }),
      );
    }
    for (const result of results) {
      expect(result).toEqual({ ok: false, status: 401, error: 'login_failed' });
    }
    expect(h.warnings.map((w) => w.msg)).toContain('sign counter replay');
  });

  it('refuses an expired challenge and a reused challenge', async () => {
    h = await createHarness();
    await doSetup(h);
    const options = await begin();
    h.clock.now += CHALLENGE_TTL_MS;
    expect(
      await loginVerify(h.deps, {
        challengeId: options.challengeId,
        response: response('cred-default'),
        userAgent: 'ua',
      }),
    ).toMatchObject({ error: 'challenge_expired' });
    expect(
      await loginVerify(h.deps, {
        challengeId: options.challengeId,
        response: response('cred-default'),
        userAgent: 'ua',
      }),
    ).toMatchObject({ error: 'challenge_invalid' });
  });

  it('works once for a good challenge', async () => {
    h = await createHarness();
    await doSetup(h);
    const options = await begin();
    const body = {
      challengeId: options.challengeId,
      response: response('cred-default'),
      userAgent: 'ua',
    };
    expect((await loginVerify(h.deps, body)).ok).toBe(true);
    expect((await loginVerify(h.deps, body)).ok).toBe(false);
  });

  it('rethrows an error that is not a WebAuthn error', async () => {
    h = await createHarness();
    await doSetup(h);
    const options = await begin();
    h.webauthn.verifyAuthentication = async () => {
      throw new Error('database down');
    };
    await expect(
      loginVerify(h.deps, {
        challengeId: options.challengeId,
        response: response('cred-default'),
        userAgent: 'ua',
      }),
    ).rejects.toThrow('database down');
  });
});
