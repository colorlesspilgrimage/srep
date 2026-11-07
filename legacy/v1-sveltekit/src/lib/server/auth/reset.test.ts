import { afterEach, describe, expect, it } from 'vitest';
import { resetAuth } from '#lib/server/auth/reset.js';
import { resolveSession } from '#lib/server/auth/sessions.js';
import { setupOptions } from '#lib/server/auth/setup.js';
import { createHarness, doSetup, type Harness } from '#lib/server/auth/test-support/harness.js';

let h: Harness;
afterEach(async () => {
  await h.handle.close();
});

describe('resetAuth', () => {
  it('opens setup again, ends old sessions and swaps the token', async () => {
    h = await createHarness();
    const done = await doSetup(h);
    const token = await resetAuth(h.deps);
    expect(await h.store.isSetupComplete()).toBe(false);
    expect(await resolveSession(h.deps, done.sessionToken)).toBeNull();
    const input = { kind: 'passkey', nickname: 'n' } as const;
    expect(await setupOptions(h.deps, { setupToken: done.setupToken, ...input })).toMatchObject({
      error: 'setup_token_invalid',
    });
    expect((await setupOptions(h.deps, { setupToken: token, ...input })).ok).toBe(true);
  });
});
