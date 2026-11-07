import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleAuth } from '#lib/server/auth/hook.js';
import { createSession } from '#lib/server/auth/sessions.js';
import { createHarness, type Harness } from '#lib/server/auth/test-support/harness.js';
import { csrfTokenFor } from '#lib/server/auth/tokens.js';

const ORIGIN = 'http://localhost:3000';
const PATH = '/api/notes/trash';

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

async function signedIn() {
  const { rawToken } = await createSession(h.deps, 'ua');
  return { cookie: rawToken, csrf: csrfTokenFor(rawToken) };
}

describe('notes trash route authorization', () => {
  it('returns 401 for GET and POST without a session', async () => {
    h = await createHarness();
    for (const method of ['GET', 'POST']) {
      const { response, resolve } = await run(PATH, {
        method,
        headers: { origin: ORIGIN, 'x-srep-csrf': 'nope', 'content-type': 'application/json' },
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'unauthenticated' });
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(resolve).not.toHaveBeenCalled();
    }
  });

  it('returns 401 for an encoded trash path without a session', async () => {
    h = await createHarness();
    const { response, resolve } = await run('/%61pi/notes/trash', { method: 'GET' });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthenticated' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('returns 403 when origin or CSRF is wrong on POST', async () => {
    h = await createHarness();
    const { cookie, csrf } = await signedIn();
    const cases: Record<string, string>[] = [
      { origin: ORIGIN },
      { origin: ORIGIN, 'x-srep-csrf': 'wrong' },
      { origin: ORIGIN, 'x-srep-csrf': csrfTokenFor('other-session') },
      { 'x-srep-csrf': csrf },
      { origin: 'http://evil.example', 'x-srep-csrf': csrf },
    ];
    for (const headers of cases) {
      const { response, resolve } = await run(PATH, { method: 'POST', cookie, headers });
      expect(response.status).toBe(403);
      expect(resolve).not.toHaveBeenCalled();
    }
  });

  it('allows GET with a session and POST with origin and CSRF', async () => {
    h = await createHarness();
    const { cookie, csrf } = await signedIn();
    const read = await run(PATH, { cookie });
    expect(read.response.status).toBe(200);
    expect(read.response.headers.get('cache-control')).toBe('no-store');
    expect(read.resolve).toHaveBeenCalledOnce();
    const write = await run(PATH, {
      method: 'POST',
      cookie,
      headers: { origin: ORIGIN, 'x-srep-csrf': csrf },
    });
    expect(write.response.status).toBe(200);
    expect(write.response.headers.get('cache-control')).toBe('no-store');
    expect(write.resolve).toHaveBeenCalledOnce();
  });
});
