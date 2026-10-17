import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleAuth } from '#lib/server/auth/hook.js';
import { createSession } from '#lib/server/auth/sessions.js';
import { createHarness, type Harness } from '#lib/server/auth/test-support/harness.js';
import { csrfTokenFor } from '#lib/server/auth/tokens.js';

// Contract: note preview, note writes, and media upload need a session.
// A write also needs the matching CSRF token and the app origin.
// A second session token does not authorize the first cookie.
// The app has one owner. A guest cannot use a note id.
// CWE-862, CWE-352, CWE-863.

const ORIGIN = 'http://localhost:3000';
const NOTE_ID = '123e4567-e89b-42d3-a456-426614174000';

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

const WRITES: { method: string; path: string }[] = [
  { method: 'POST', path: '/api/notes/preview' },
  { method: 'POST', path: '/api/notes' },
  { method: 'PATCH', path: `/api/notes/${NOTE_ID}` },
  { method: 'POST', path: '/api/media' },
];

describe('note and media route authorization', () => {
  it('returns 401 for a guest on preview, note create, note update, and media', async () => {
    h = await createHarness();
    for (const item of WRITES) {
      const { response, resolve } = await run(item.path, {
        method: item.method,
        headers: { origin: ORIGIN, 'x-srep-csrf': 'nope', 'content-type': 'application/json' },
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'unauthenticated' });
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(resolve).not.toHaveBeenCalled();
    }
    const read = await run(`/api/notes/${NOTE_ID}`);
    expect(read.response.status).toBe(401);
    expect(read.resolve).not.toHaveBeenCalled();
    const encoded = await run('/%61pi/notes/preview', { method: 'POST' });
    expect(encoded.response.status).toBe(401);
    expect(encoded.resolve).not.toHaveBeenCalled();
  });

  it('returns 403 when the CSRF token or the origin is missing or wrong', async () => {
    h = await createHarness();
    const first = await signedIn();
    const second = await signedIn();
    const cases: Record<string, string>[] = [
      { origin: ORIGIN },
      { origin: ORIGIN, 'x-srep-csrf': 'wrong' },
      { origin: ORIGIN, 'x-srep-csrf': second.csrf },
      { origin: ORIGIN, 'x-srep-csrf': csrfTokenFor('other-session') },
      { 'x-srep-csrf': first.csrf },
      { origin: 'http://evil.example', 'x-srep-csrf': first.csrf },
    ];
    for (const item of WRITES) {
      for (const headers of cases) {
        const { response, resolve } = await run(item.path, {
          method: item.method,
          cookie: first.cookie,
          headers,
        });
        expect(response.status).toBe(403);
        expect(resolve).not.toHaveBeenCalled();
      }
    }
    const encoded = await run('/%61pi/notes/preview', {
      method: 'POST',
      cookie: first.cookie,
      headers: { origin: ORIGIN },
    });
    expect(encoded.response.status).toBe(403);
    expect(await encoded.response.json()).toEqual({ error: 'bad_csrf' });
    expect(encoded.resolve).not.toHaveBeenCalled();
  });

  it('allows a signed-in write when the origin and CSRF token match', async () => {
    h = await createHarness();
    const { cookie, csrf } = await signedIn();
    for (const item of WRITES) {
      const { response, resolve } = await run(item.path, {
        method: item.method,
        cookie,
        headers: { origin: ORIGIN, 'x-srep-csrf': csrf },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(resolve).toHaveBeenCalledOnce();
    }
    const read = await run(`/api/notes/${NOTE_ID}`, { cookie });
    expect(read.response.status).toBe(200);
    expect(read.response.headers.get('cache-control')).toBe('no-store');
    expect(read.resolve).toHaveBeenCalledOnce();
  });
});
