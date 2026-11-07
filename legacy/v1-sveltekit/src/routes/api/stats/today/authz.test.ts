import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleAuth } from '#lib/server/auth/hook.js';
import { createSession } from '#lib/server/auth/sessions.js';
import { createHarness, type Harness } from '#lib/server/auth/test-support/harness.js';

const ORIGIN = 'http://localhost:3000';
const PATH = '/api/stats/today';

let h: Harness;

afterEach(async () => {
  await h.handle.close();
});

function makeEvent(path: string, cookie?: string): RequestEvent {
  const url = new URL(ORIGIN + path);
  return {
    url,
    request: new Request(url, { method: 'GET' }),
    cookies: { get: (name: string) => (name === 'srep_session' ? cookie : undefined) },
    locals: { session: null },
  } as unknown as RequestEvent;
}

describe('stats route authorization', () => {
  it('returns 401 without a session', async () => {
    h = await createHarness();
    const resolve = vi.fn(async () => new Response('{}', { status: 200 }));
    const response = await handleAuth(h.deps, makeEvent(PATH), resolve);
    expect(response.status).toBe(401);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('allows GET with a session', async () => {
    h = await createHarness();
    const { rawToken } = await createSession(h.deps, 'ua');
    const resolve = vi.fn(async () => new Response('{}', { status: 200 }));
    const response = await handleAuth(h.deps, makeEvent(PATH, rawToken), resolve);
    expect(response.status).toBe(200);
    expect(resolve).toHaveBeenCalledOnce();
  });
});
