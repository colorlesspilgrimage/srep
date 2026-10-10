import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/auth/context.js', async () => {
  const { routeState } = await import('#lib/server/auth/test-support/route-support.js');
  return { getAuthContext: () => routeState.ctx };
});
import { makeEvent, useRouteContext } from '#lib/server/auth/test-support/route-support.js';
import { doSetup, type Harness } from '#lib/server/auth/test-support/harness.js';
import { GET } from './+server';

let h: Harness;
afterEach(async () => {
  await h.handle.close();
});

describe('GET /api/auth/status', () => {
  it('returns exactly the guest body on a fresh instance', async () => {
    ({ h } = await useRouteContext());
    const { event } = makeEvent('/api/auth/status', { method: 'GET' });
    const text = await (await GET(event)).text();
    expect(text).toBe('{"setupComplete":false,"authenticated":false}');
  });

  it('does not reveal counts or names after setup', async () => {
    ({ h } = await useRouteContext());
    await doSetup(h);
    const { event } = makeEvent('/api/auth/status', { method: 'GET' });
    const text = await (await GET(event)).text();
    expect(text).toBe('{"setupComplete":true,"authenticated":false}');
  });

  it('gives the CSRF token only to a signed-in user', async () => {
    ({ h } = await useRouteContext());
    const { event } = makeEvent('/api/auth/status', {
      method: 'GET',
      session: { id: 's', csrfToken: 'tok' },
    });
    expect(await (await GET(event)).json()).toEqual({
      setupComplete: false,
      authenticated: true,
      csrfToken: 'tok',
    });
  });
});
