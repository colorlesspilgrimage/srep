import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/auth/context.js', async () => {
  const { routeState } = await import('#lib/server/auth/test-support/route-support.js');
  return { getAuthContext: () => routeState.ctx };
});
import { createSession, resolveSession } from '#lib/server/auth/sessions.js';
import type { Harness } from '#lib/server/auth/test-support/harness.js';
import { makeEvent, useRouteContext } from '#lib/server/auth/test-support/route-support.js';
import { POST as logoutAllPost } from '../logout-all/+server';
import { POST } from './+server';

let h: Harness;
afterEach(async () => {
  await h.handle.close();
});

describe('logout routes', () => {
  it('ends only the current session and clears the cookie', async () => {
    ({ h } = await useRouteContext());
    const a = await createSession(h.deps, 'a');
    const b = await createSession(h.deps, 'b');
    const row = await resolveSession(h.deps, a.rawToken);
    const { event, cookiesSet } = makeEvent('/api/auth/logout', {
      session: { id: row?.id ?? '', csrfToken: 'x' },
    });
    expect(await (await POST(event)).json()).toEqual({ ok: true });
    expect(await resolveSession(h.deps, a.rawToken)).toBeNull();
    expect(await resolveSession(h.deps, b.rawToken)).not.toBeNull();
    expect(cookiesSet[0]).toMatchObject({
      name: 'srep_session',
      value: '',
      options: { maxAge: 0, httpOnly: true, sameSite: 'strict' },
    });
  });

  it('ends every session on logout-all', async () => {
    ({ h } = await useRouteContext());
    const a = await createSession(h.deps, 'a');
    const b = await createSession(h.deps, 'b');
    const { event, cookiesSet } = makeEvent('/api/auth/logout-all', {
      session: { id: 'x', csrfToken: 'x' },
    });
    expect(await (await logoutAllPost(event)).json()).toEqual({ ok: true });
    expect(await resolveSession(h.deps, a.rawToken)).toBeNull();
    expect(await resolveSession(h.deps, b.rawToken)).toBeNull();
    expect(cookiesSet[0]?.options).toMatchObject({ maxAge: 0 });
  });
});
