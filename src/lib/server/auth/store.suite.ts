import { afterEach, describe, expect, it } from 'vitest';
import type { AuthStore, CredentialRow, SessionRow } from '#lib/server/auth/store.js';
import type { Harness } from '#lib/server/auth/test-support/harness.js';

function credential(id: string, extra: Partial<CredentialRow> = {}): CredentialRow {
  return {
    id,
    credentialId: `cid-${id}`,
    publicKey: 'pk',
    signCount: 0,
    transports: ['usb'],
    kind: 'passkey',
    nickname: `nick ${id}`,
    createdAt: 1,
    lastUsedAt: null,
    ...extra,
  };
}

function session(id: string): SessionRow {
  return {
    id,
    tokenHash: `hash-${id}`,
    createdAt: 1,
    lastSeenAt: 1,
    expiresAt: 100,
    userAgent: 'ua',
  };
}

function setupInput(id: string, credentialId = `cid-${id}`) {
  return {
    credential: credential(id, { credentialId }),
    recoveryHashes: Array.from({ length: 10 }, (_, i) => ({
      id: `${id}-r${i}`,
      codeHash: `h${i}`,
    })),
    session: session(id),
    now: 5,
  };
}

// One suite for every dialect. SQLite runs always. Postgres runs when a URL is set.
export function defineStoreSuite(make: () => Promise<Harness>): void {
  let harness: Harness | undefined;

  afterEach(async () => {
    await harness?.handle.close();
    harness = undefined;
  });

  async function store(): Promise<AuthStore> {
    harness = await make();
    return harness.store;
  }

  describe('completeSetup', () => {
    it('writes credential, recovery rows, settings and session together', async () => {
      const s = await store();
      await s.armSetup('token-hash');
      expect(await s.getSetupTokenHash()).toBe('token-hash');
      expect(await s.completeSetup(setupInput('a'))).toEqual({ ok: true });
      expect(await s.isSetupComplete()).toBe(true);
      expect(await s.getSetupTokenHash()).toBeNull();
      expect(await s.listCredentials()).toHaveLength(1);
      expect(await s.listUnusedRecovery()).toHaveLength(10);
      expect(await s.getSessionByTokenHash('hash-a')).toBeDefined();
    });

    it('returns locked on a second call and writes nothing', async () => {
      const s = await store();
      await s.completeSetup(setupInput('a'));
      expect(await s.completeSetup(setupInput('b'))).toEqual({ ok: false, reason: 'locked' });
      expect(await s.listCredentials()).toHaveLength(1);
      expect(await s.listUnusedRecovery()).toHaveLength(10);
      expect(await s.getSessionByTokenHash('hash-b')).toBeUndefined();
    });

    it('gives one success for two parallel calls', async () => {
      const s = await store();
      const results = await Promise.all([
        s.completeSetup(setupInput('a')),
        s.completeSetup(setupInput('b')),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(await s.listCredentials()).toHaveLength(1);
    });

    it('rolls back when an insert fails', async () => {
      const s = await store();
      await s.insertCredential(credential('x', { credentialId: 'dup' }));
      await expect(s.completeSetup(setupInput('a', 'dup'))).rejects.toThrow();
      expect(await s.isSetupComplete()).toBe(false);
      expect(await s.listUnusedRecovery()).toHaveLength(0);
      expect(await s.getSessionByTokenHash('hash-a')).toBeUndefined();
    });
  });

  describe('credentials', () => {
    it('refuses to delete the last credential', async () => {
      const s = await store();
      await s.insertCredential(credential('a'));
      expect(await s.deleteCredentialUnlessLast('a')).toBe('last_credential');
      expect(await s.listCredentials()).toHaveLength(1);
    });

    it('deletes one of two and reports an unknown id', async () => {
      const s = await store();
      await s.insertCredential(credential('a'));
      await s.insertCredential(credential('b'));
      expect(await s.deleteCredentialUnlessLast('zzz')).toBe('not_found');
      expect(await s.deleteCredentialUnlessLast('a')).toBe('deleted');
      expect(await s.getCredentialById('a')).toBeUndefined();
    });

    it('leaves one credential after two parallel deletes', async () => {
      const s = await store();
      await s.insertCredential(credential('a'));
      await s.insertCredential(credential('b'));
      await Promise.all([s.deleteCredentialUnlessLast('a'), s.deleteCredentialUnlessLast('b')]);
      expect(await s.listCredentials()).toHaveLength(1);
    });

    it('renames, finds by credential id and updates the counter', async () => {
      const s = await store();
      await s.insertCredential(credential('a'));
      expect(await s.renameCredential('a', 'new')).toBe(true);
      expect(await s.renameCredential('nope', 'new')).toBe(false);
      expect((await s.getCredentialByCredentialId('cid-a'))?.nickname).toBe('new');
      await s.updateSignCount('a', 7, 99);
      const row = await s.getCredentialById('a');
      expect(row?.signCount).toBe(7);
      expect(row?.lastUsedAt).toBe(99);
    });

    it('stores an SQL injection string as plain text', async () => {
      const s = await store();
      const nickname = "'); DROP TABLE auth_credential;--";
      await s.insertCredential(credential('a', { nickname }));
      expect((await s.getCredentialById('a'))?.nickname).toBe(nickname);
      expect(await s.listCredentials()).toHaveLength(1);
    });

    it('round-trips transports as JSON', async () => {
      const s = await store();
      await s.insertCredential(credential('a', { transports: ['usb', 'nfc'] }));
      expect((await s.getCredentialById('a'))?.transports).toEqual(['usb', 'nfc']);
    });
  });

  describe('challenges, recovery and sessions', () => {
    it('uses a challenge once', async () => {
      const s = await store();
      await s.insertChallenge({ id: 'c1', challenge: 'x', purpose: 'login', expiresAt: 50 });
      expect((await s.consumeChallenge('c1'))?.challenge).toBe('x');
      expect(await s.consumeChallenge('c1')).toBeUndefined();
    });

    it('prunes expired challenges only', async () => {
      const s = await store();
      await s.insertChallenge({ id: 'old', challenge: 'x', purpose: 'login', expiresAt: 10 });
      await s.insertChallenge({ id: 'new', challenge: 'y', purpose: 'login', expiresAt: 11 });
      await s.pruneChallenges(10);
      expect(await s.consumeChallenge('old')).toBeUndefined();
      expect(await s.consumeChallenge('new')).toBeDefined();
    });

    it('uses a recovery row once', async () => {
      const s = await store();
      await s.completeSetup(setupInput('a'));
      expect(await s.consumeRecovery('a-r0', 9)).toBe(true);
      expect(await s.consumeRecovery('a-r0', 9)).toBe(false);
      expect(await s.listUnusedRecovery()).toHaveLength(9);
    });

    it('manages sessions', async () => {
      const s = await store();
      await s.insertSession(session('a'));
      await s.insertSession(session('b'));
      await s.touchSession('a', 42);
      expect((await s.getSessionByTokenHash('hash-a'))?.lastSeenAt).toBe(42);
      await s.deleteSession('a');
      expect(await s.getSessionByTokenHash('hash-a')).toBeUndefined();
      await s.deleteAllSessions();
      expect(await s.getSessionByTokenHash('hash-b')).toBeUndefined();
    });

    it('deletes absolute and idle expired sessions', async () => {
      const s = await store();
      await s.insertSession({ ...session('abs'), expiresAt: 100, lastSeenAt: 99 });
      await s.insertSession({ ...session('idle'), expiresAt: 10_000, lastSeenAt: 10 });
      await s.insertSession({ ...session('live'), expiresAt: 10_000, lastSeenAt: 95 });
      await s.deleteExpiredSessions(100, 50);
      expect(await s.getSessionByTokenHash('hash-abs')).toBeUndefined();
      expect(await s.getSessionByTokenHash('hash-idle')).toBeUndefined();
      expect(await s.getSessionByTokenHash('hash-live')).toBeDefined();
    });
  });

  describe('user id, arm and reset', () => {
    it('keeps the first user id', async () => {
      const s = await store();
      expect(await s.getOrCreateUserId('first')).toBe('first');
      expect(await s.getOrCreateUserId('second')).toBe('first');
    });

    it('does not arm setup after it is complete', async () => {
      const s = await store();
      await s.completeSetup(setupInput('a'));
      await s.armSetup('late');
      expect(await s.getSetupTokenHash()).toBeNull();
    });

    it('removes all auth data and arms a new token on reset', async () => {
      const s = await store();
      await s.getOrCreateUserId('uid');
      await s.completeSetup(setupInput('a'));
      await s.insertChallenge({ id: 'c', challenge: 'x', purpose: 'login', expiresAt: 50 });
      await s.resetAuth({ tokenHash: 'new-hash' });
      expect(await s.isSetupComplete()).toBe(false);
      expect(await s.getSetupTokenHash()).toBe('new-hash');
      expect(await s.listCredentials()).toHaveLength(0);
      expect(await s.listUnusedRecovery()).toHaveLength(0);
      expect(await s.getSessionByTokenHash('hash-a')).toBeUndefined();
      expect(await s.consumeChallenge('c')).toBeUndefined();
      expect(await s.getOrCreateUserId('fresh')).toBe('fresh');
    });
  });
}
