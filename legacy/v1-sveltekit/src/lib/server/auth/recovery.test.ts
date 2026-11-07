import { afterEach, describe, expect, it } from 'vitest';
import { recoveryLogin } from '#lib/server/auth/recovery.js';
import { resetAuth } from '#lib/server/auth/reset.js';
import { createHarness, doSetup, type Harness } from '#lib/server/auth/test-support/harness.js';

let h: Harness;
afterEach(async () => {
  await h.handle.close();
});

const ua = 'ua';

describe('recoveryLogin', () => {
  it('gives a session and the remaining count', async () => {
    h = await createHarness();
    const done = await doSetup(h);
    const result = await recoveryLogin(h.deps, {
      code: done.recoveryCodes[0] ?? '',
      userAgent: ua,
    });
    expect(result).toMatchObject({ ok: true, remaining: 9 });
    expect(h.warnings.map((w) => w.msg)).toContain('recovery code used');
    expect(JSON.stringify(h.warnings)).not.toContain(done.recoveryCodes[0]);
  });

  it('refuses the same code a second time', async () => {
    h = await createHarness();
    const done = await doSetup(h);
    const code = done.recoveryCodes[1] ?? '';
    expect((await recoveryLogin(h.deps, { code, userAgent: ua })).ok).toBe(true);
    expect(await recoveryLogin(h.deps, { code, userAgent: ua })).toEqual({
      ok: false,
      status: 401,
      error: 'recovery_failed',
    });
  });

  it('gives the same error for a wrong code and a malformed code', async () => {
    h = await createHarness();
    await doSetup(h);
    const wrong = await recoveryLogin(h.deps, { code: '00000-00000', userAgent: ua });
    const bad = await recoveryLogin(h.deps, { code: 'short', userAgent: ua });
    expect(wrong).toEqual(bad);
    expect(wrong).toMatchObject({ status: 401, error: 'recovery_failed' });
  });

  it('accepts lowercase and unformatted codes', async () => {
    h = await createHarness();
    const done = await doSetup(h);
    const code = (done.recoveryCodes[2] ?? '').toLowerCase().replace('-', '');
    expect((await recoveryLogin(h.deps, { code, userAgent: ua })).ok).toBe(true);
  });

  it('refuses a code from before a reset', async () => {
    h = await createHarness();
    const done = await doSetup(h);
    await resetAuth(h.deps);
    expect(
      (await recoveryLogin(h.deps, { code: done.recoveryCodes[3] ?? '', userAgent: ua })).ok,
    ).toBe(false);
  });

  it('refuses a code when two requests race for it', async () => {
    h = await createHarness();
    const done = await doSetup(h);
    const code = done.recoveryCodes[4] ?? '';
    const [a, b] = await Promise.all([
      recoveryLogin(h.deps, { code, userAgent: ua }),
      recoveryLogin(h.deps, { code, userAgent: ua }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  });
});
