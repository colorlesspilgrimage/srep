import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleAuth } from '#lib/server/auth/hook.js';
import { createSession } from '#lib/server/auth/sessions.js';
import { createHarness, type Harness } from '#lib/server/auth/test-support/harness.js';

// Contract: unused recovery count needs a session. CWE-862, CWE-863.

const ORIGIN = 'http://localhost:3000';
const PATH = '/api/auth/recovery';

let h: Harness;

afterEach(async () => {
  await h.handle.close();
});

type Opts = { method?: string; headers?: Record<string, string>; cookie?: string };

function makeEvent(path: string, opts: Opts = {}): RequestEvent {
  const url = new URL(ORIGIN + path);
  return {
    url,
    request: new Request(url, { method: opts.method ?? 'GET', headers: opts.headers }),
    cookies: { get: (name: string) => (name === 'srep_session' ? opts.cookie : undefined) },
    locals: { session: null },
  } as unknown as RequestEvent;
}

async function run(path: string, opts: Opts = {}) {
  const resolve = vi.fn(async () => new Response('{}', { status: 200 }));
  const response = await handleAuth(h.deps, makeEvent(path, opts), resolve);
  return { response, resolve };
}

describe('recovery count route authorization', () => {
  it('returns 401 without a session', async () => {
    h = await createHarness();
    const { response, resolve } = await run(PATH);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthenticated' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(resolve).not.toHaveBeenCalled();
  });

  it('returns 401 for an encoded recovery path without a session', async () => {
    h = await createHarness();
    const { response, resolve } = await run('/%61pi/auth/recovery');
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthenticated' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('allows GET with a session', async () => {
    h = await createHarness();
    const { rawToken } = await createSession(h.deps, 'ua');
    const { response, resolve } = await run(PATH, { cookie: rawToken });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(resolve).toHaveBeenCalledOnce();
  });
});
