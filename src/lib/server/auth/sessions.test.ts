import { afterEach, describe, expect, it } from 'vitest';
import {
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  TOUCH_INTERVAL_MS,
} from '#lib/server/auth/session-policy.js';
import {
  createSession,
  logout,
  logoutAll,
  purgeExpired,
  resolveSession,
} from '#lib/server/auth/sessions.js';
import { createHarness, type Harness } from '#lib/server/auth/test-support/harness.js';
import { sha256Hex } from '#lib/server/auth/tokens.js';

let h: Harness;
afterEach(async () => {
  await h.handle.close();
});

describe('sessions', () => {
  it('creates and resolves a session and stores only the hash', async () => {
    h = await createHarness();
    const { rawToken, maxAgeSec } = await createSession(h.deps, 'agent');
    expect(maxAgeSec).toBe(SESSION_ABSOLUTE_MS / 1000);
    const row = await h.store.getSessionByTokenHash(sha256Hex(rawToken));
    expect(row?.tokenHash).toBe(sha256Hex(rawToken));
    expect(JSON.stringify(row)).not.toContain(rawToken);
    expect((await resolveSession(h.deps, rawToken))?.id).toBe(row?.id);
  });

  it('cuts the user agent to 256 characters', async () => {
    h = await createHarness();
    const { rawToken } = await createSession(h.deps, 'x'.repeat(300));
    expect((await h.store.getSessionByTokenHash(sha256Hex(rawToken)))?.userAgent).toHaveLength(256);
  });

  it('returns null for an unknown token', async () => {
    h = await createHarness();
    expect(await resolveSession(h.deps, 'nope')).toBeNull();
  });

  it('expires after the idle time and deletes the row', async () => {
    h = await createHarness();
    const { rawToken } = await createSession(h.deps, 'a');
    h.clock.now += SESSION_IDLE_MS - 1;
    expect(await resolveSession(h.deps, rawToken)).not.toBeNull();
    h.clock.now += SESSION_IDLE_MS;
    expect(await resolveSession(h.deps, rawToken)).toBeNull();
    expect(await h.store.getSessionByTokenHash(sha256Hex(rawToken))).toBeUndefined();
  });

  it('expires at the absolute time even with activity', async () => {
    h = await createHarness();
    const start = h.clock.now;
    const { rawToken } = await createSession(h.deps, 'a');
    for (let day = 6; day < 30; day += 6) {
      h.clock.now = start + day * 24 * 3600 * 1000;
      expect(await resolveSession(h.deps, rawToken)).not.toBeNull();
    }
    h.clock.now = start + SESSION_ABSOLUTE_MS;
    expect(await resolveSession(h.deps, rawToken)).toBeNull();
  });

  it('touches the session only after the touch interval', async () => {
    h = await createHarness();
    const { rawToken } = await createSession(h.deps, 'a');
    const hash = sha256Hex(rawToken);
    const created = h.clock.now;
    h.clock.now += TOUCH_INTERVAL_MS - 1;
    await resolveSession(h.deps, rawToken);
    expect((await h.store.getSessionByTokenHash(hash))?.lastSeenAt).toBe(created);
    h.clock.now += 1;
    await resolveSession(h.deps, rawToken);
    expect((await h.store.getSessionByTokenHash(hash))?.lastSeenAt).toBe(h.clock.now);
  });

  it('logs out one session or all sessions', async () => {
    h = await createHarness();
    const a = await createSession(h.deps, 'a');
    const b = await createSession(h.deps, 'b');
    const rowA = await resolveSession(h.deps, a.rawToken);
    await logout(h.deps, rowA?.id ?? '');
    expect(await resolveSession(h.deps, a.rawToken)).toBeNull();
    expect(await resolveSession(h.deps, b.rawToken)).not.toBeNull();
    await logoutAll(h.deps);
    expect(await resolveSession(h.deps, b.rawToken)).toBeNull();
  });

  it('purges expired sessions', async () => {
    h = await createHarness();
    const { rawToken } = await createSession(h.deps, 'a');
    h.clock.now += SESSION_IDLE_MS;
    await purgeExpired(h.deps);
    expect(await h.store.getSessionByTokenHash(sha256Hex(rawToken))).toBeUndefined();
  });
});
