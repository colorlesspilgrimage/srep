import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleAuth } from '#lib/server/auth/hook.js';
import { createSession } from '#lib/server/auth/sessions.js';
import { createHarness, type Harness } from '#lib/server/auth/test-support/harness.js';
import { csrfTokenFor } from '#lib/server/auth/tokens.js';

// Contract: theme reads and writes need a session. Writes also need origin and CSRF.
// CWE-862, CWE-352, CWE-863.

const ORIGIN = 'http://localhost:3000';
const PATH = '/api/settings/theme';

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

describe('theme route authorization', () => {
  it('returns 401 for GET and PUT without a session', async () => {
    h = await createHarness();
    for (const method of ['GET', 'PUT']) {
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

  it('returns 401 for an encoded theme path without a session', async () => {
    h = await createHarness();
    const { response, resolve } = await run('/%61pi/settings/theme', { method: 'PUT' });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthenticated' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('returns 403 when origin or CSRF is wrong', async () => {
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
      const { response, resolve } = await run(PATH, { method: 'PUT', cookie, headers });
      expect(response.status).toBe(403);
      expect(resolve).not.toHaveBeenCalled();
    }
  });

  it('returns 403 for an encoded PUT without CSRF', async () => {
    h = await createHarness();
    const { cookie } = await signedIn();
    const { response, resolve } = await run('/%61pi/settings/theme', {
      method: 'PUT',
      cookie,
      headers: { origin: ORIGIN },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'bad_csrf' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('allows GET with a session and PUT with origin and CSRF', async () => {
    h = await createHarness();
    const { cookie, csrf } = await signedIn();
    const read = await run(PATH, { cookie });
    expect(read.response.status).toBe(200);
    expect(read.response.headers.get('cache-control')).toBe('no-store');
    expect(read.resolve).toHaveBeenCalledOnce();
    const write = await run(PATH, {
      method: 'PUT',
      cookie,
      headers: { origin: ORIGIN, 'x-srep-csrf': csrf },
    });
    expect(write.response.status).toBe(200);
    expect(write.response.headers.get('cache-control')).toBe('no-store');
    expect(write.resolve).toHaveBeenCalledOnce();
  });
});
