import { afterEach, describe, expect, it } from 'vitest';
import {
  listCredentials,
  registerOptions,
  registerVerify,
  renameCredential,
  revokeCredential,
} from '#lib/server/auth/credentials.js';
import { createHarness, doSetup, type Harness } from '#lib/server/auth/test-support/harness.js';

let h: Harness;
afterEach(async () => {
  await h.handle.close();
});

const response = { id: 'x' } as never;

async function add(nickname: string, credentialId: string) {
  const options = await registerOptions(h.deps, { kind: 'security_key', nickname });
  if (!options.ok) throw new Error(options.error);
  h.webauthn.registration = { credentialId, publicKey: 'pk', signCount: 0, transports: ['usb'] };
  return registerVerify(h.deps, {
    challengeId: options.challengeId,
    response,
    kind: 'security_key',
    nickname,
  });
}

describe('list', () => {
  it('never returns key material', async () => {
    h = await createHarness();
    await doSetup(h);
    const list = await listCredentials(h.deps);
    expect(list).toHaveLength(1);
    const text = JSON.stringify(list);
    expect(text).not.toContain('publicKey');
    expect(text).not.toContain('cred-default');
    expect(text).not.toContain('signCount');
    expect(Object.keys(list[0] ?? {}).sort()).toEqual([
      'createdAt',
      'id',
      'kind',
      'lastUsedAt',
      'nickname',
      'transports',
    ]);
  });
});

describe('rename', () => {
  it('trims the nickname', async () => {
    h = await createHarness();
    await doSetup(h);
    const [first] = await listCredentials(h.deps);
    expect(await renameCredential(h.deps, first?.id ?? '', '  New name  ')).toEqual({ ok: true });
    expect((await listCredentials(h.deps))[0]?.nickname).toBe('New name');
  });

  it.each([[''], ['   '], ['a'.repeat(65)], ['bad\u0007name'], ['line\nbreak']])(
    'rejects %j',
    async (nickname) => {
      h = await createHarness();
      await doSetup(h);
      const [first] = await listCredentials(h.deps);
      expect(await renameCredential(h.deps, first?.id ?? '', nickname)).toMatchObject({
        status: 400,
        error: 'invalid_nickname',
      });
    },
  );

  it('accepts 64 characters and returns 404 for an unknown id', async () => {
    h = await createHarness();
    await doSetup(h);
    const [first] = await listCredentials(h.deps);
    expect((await renameCredential(h.deps, first?.id ?? '', 'a'.repeat(64))).ok).toBe(true);
    expect(await renameCredential(h.deps, 'nope', 'name')).toMatchObject({
      status: 404,
      error: 'not_found',
    });
  });
});

describe('revoke', () => {
  it('refuses the last credential with 409', async () => {
    h = await createHarness();
    await doSetup(h);
    const [first] = await listCredentials(h.deps);
    expect(await revokeCredential(h.deps, first?.id ?? '')).toMatchObject({
      status: 409,
      error: 'last_credential',
    });
    expect(await listCredentials(h.deps)).toHaveLength(1);
  });

  it('works with two credentials and gives 404 for an unknown id', async () => {
    h = await createHarness();
    await doSetup(h);
    const added = await add('Key', 'key-1');
    expect(added.ok).toBe(true);
    expect(await revokeCredential(h.deps, 'nope')).toMatchObject({ status: 404 });
    const list = await listCredentials(h.deps);
    expect(await revokeCredential(h.deps, list[0]?.id ?? '')).toEqual({ ok: true });
    expect(await listCredentials(h.deps)).toHaveLength(1);
  });
});

describe('add a credential', () => {
  it('adds with the register purpose', async () => {
    h = await createHarness();
    await doSetup(h);
    const added = await add('Key', 'key-1');
    expect(added).toMatchObject({
      ok: true,
      credential: { nickname: 'Key', kind: 'security_key' },
    });
    expect(await listCredentials(h.deps)).toHaveLength(2);
  });

  it('rejects a duplicate credential id with 409', async () => {
    h = await createHarness();
    await doSetup(h);
    expect(await add('Again', 'cred-default')).toMatchObject({
      status: 409,
      error: 'duplicate_credential',
    });
  });

  it('rejects a login challenge', async () => {
    h = await createHarness();
    await doSetup(h);
    await h.store.insertChallenge({
      id: 'c-login',
      challenge: 'x',
      purpose: 'login',
      expiresAt: h.clock.now + 1000,
    });
    expect(
      await registerVerify(h.deps, {
        challengeId: 'c-login',
        response,
        kind: 'passkey',
        nickname: 'n',
      }),
    ).toMatchObject({ error: 'challenge_invalid' });
  });

  it('rejects a bad nickname and a failed verification', async () => {
    h = await createHarness();
    await doSetup(h);
    expect(await registerOptions(h.deps, { kind: 'passkey', nickname: '' })).toMatchObject({
      error: 'invalid_nickname',
    });
    expect(
      await registerVerify(h.deps, { challengeId: 'x', response, kind: 'passkey', nickname: '' }),
    ).toMatchObject({ error: 'invalid_nickname' });
    const options = await registerOptions(h.deps, { kind: 'passkey', nickname: 'n' });
    if (!options.ok) throw new Error('options');
    h.webauthn.registration = 'fail';
    expect(
      await registerVerify(h.deps, {
        challengeId: options.challengeId,
        response,
        kind: 'passkey',
        nickname: 'n',
      }),
    ).toMatchObject({ status: 400, error: 'verification_failed' });
  });

  it('rethrows an unexpected error', async () => {
    h = await createHarness();
    await doSetup(h);
    const options = await registerOptions(h.deps, { kind: 'passkey', nickname: 'n' });
    if (!options.ok) throw new Error('options');
    h.webauthn.verifyRegistration = async () => {
      throw new Error('boom');
    };
    await expect(
      registerVerify(h.deps, {
        challengeId: options.challengeId,
        response,
        kind: 'passkey',
        nickname: 'n',
      }),
    ).rejects.toThrow('boom');
  });
});
