import { afterEach, describe, expect, it, vi } from 'vitest';
import { announceSetupToken, startMaintenance } from '#lib/server/auth/startup.js';
import { createLimiters } from '#lib/server/auth/limiters.js';
import { createSession } from '#lib/server/auth/sessions.js';
import { SESSION_IDLE_MS } from '#lib/server/auth/session-policy.js';
import { createHarness, doSetup, type Harness } from '#lib/server/auth/test-support/harness.js';
import { sha256Hex } from '#lib/server/auth/tokens.js';

let h: Harness;
afterEach(async () => {
  vi.useRealTimers();
  await h.handle.close();
});

describe('announceSetupToken', () => {
  it('logs the token in one line when setup is open', async () => {
    h = await createHarness();
    await announceSetupToken(h.deps);
    expect(h.warnings).toHaveLength(1);
    const line = h.warnings[0]?.msg ?? '';
    expect(line).toContain('srep setup is not complete');
    expect(line).toContain('http://localhost:3000/setup');
    const token = /setup token: (\S+)$/.exec(line)?.[1] ?? '';
    expect(await h.store.getSetupTokenHash()).toBe(sha256Hex(token));
    expect(JSON.stringify(h.warnings[0]?.obj)).not.toContain(token);
  });

  it('logs nothing when setup is complete', async () => {
    h = await createHarness();
    await doSetup(h);
    await announceSetupToken(h.deps);
    expect(h.warnings).toHaveLength(0);
  });
});

describe('startMaintenance', () => {
  it('purges at start and on a timer, and stops', async () => {
    h = await createHarness();
    vi.useFakeTimers();
    const old = await createSession(h.deps, 'a');
    h.clock.now += SESSION_IDLE_MS;
    const stop = await startMaintenance(h.deps);
    expect(await h.store.getSessionByTokenHash(sha256Hex(old.rawToken))).toBeUndefined();
    const next = await createSession(h.deps, 'b');
    h.clock.now += SESSION_IDLE_MS;
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(await h.store.getSessionByTokenHash(sha256Hex(next.rawToken))).toBeUndefined();
    stop();
    const last = await createSession(h.deps, 'c');
    h.clock.now += SESSION_IDLE_MS;
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(await h.store.getSessionByTokenHash(sha256Hex(last.rawToken))).toBeDefined();
  });

  it('logs a warning and keeps going when cleanup fails', async () => {
    h = await createHarness();
    h.deps.store.deleteExpiredSessions = async () => {
      throw new Error('db down');
    };
    const stop = await startMaintenance(h.deps);
    stop();
    expect(h.warnings.map((w) => w.msg)).toContain('auth cleanup failed');
  });
});

describe('createLimiters', () => {
  it('sets the documented limits', () => {
    const now = 0;
    const limiters = createLimiters(() => now);
    for (let i = 0; i < 20; i += 1) {
      expect(limiters.authAttempts.check('a').allowed).toBe(true);
    }
    expect(limiters.authAttempts.check('a').allowed).toBe(false);
    for (let i = 0; i < 5; i += 1) {
      limiters.setupTokenFailures.check('k');
      limiters.recoveryFailures.check('k');
    }
    expect(limiters.setupTokenFailures.check('k').allowed).toBe(false);
    expect(limiters.recoveryFailures.check('k').allowed).toBe(false);
  });
});
