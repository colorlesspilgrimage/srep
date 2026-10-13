import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleAuth } from '#lib/server/auth/hook.js';
import { SESSION_IDLE_MS } from '#lib/server/auth/session-policy.js';
import { createSession } from '#lib/server/auth/sessions.js';
import { createHarness, doSetup, type Harness } from '#lib/server/auth/test-support/harness.js';
import { csrfTokenFor } from '#lib/server/auth/tokens.js';

const ORIGIN = 'http://localhost:3000';
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
  const resolve = vi.fn(async () => new Response('page', { status: 200 }));
  const event = makeEvent(path, opts);
  const response = await handleAuth(h.deps, event, resolve);
  return { response, resolve, event };
}

async function signedIn() {
  const { rawToken } = await createSession(h.deps, 'ua');
  return { cookie: rawToken, csrf: csrfTokenFor(rawToken) };
}

describe('unauthenticated API access', () => {
  it.each([
    ['GET', '/api/decks'],
    ['GET', '/api/auth/credentials'],
    ['GET', '/api/zzz'],
    ['GET', '/api'],
    ['PUT', '/api/auth/status'],
    ['GET', '/api/auth/status/'],
    ['GET', '/%61pi/decks'],
    ['GET', '/%61pi/auth/credentials'],
    ['GET', '/api/auth/%73tatus'],
    ['POST', '/%61pi/auth/login/options'],
  ])('%s %s returns 401 JSON', async (method, path) => {
    h = await createHarness();
    const { response, resolve } = await run(path, { method });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthenticated' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(resolve).not.toHaveBeenCalled();
  });

  it('lets the public status route pass', async () => {
    h = await createHarness();
    const { response, resolve } = await run('/api/auth/status');
    expect(response.status).toBe(200);
    expect(resolve).toHaveBeenCalledOnce();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('returns 401 for an expired session', async () => {
    h = await createHarness();
    const { cookie } = await signedIn();
    h.clock.now += SESSION_IDLE_MS;
    const { response } = await run('/api/auth/credentials', { cookie });
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('clears an invalid cookie', async () => {
    h = await createHarness();
    const { response } = await run('/api/auth/status', { cookie: 'junk' });
    expect(response.headers.get('set-cookie')).toBe(
      'srep_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict',
    );
  });

  // Regression: a login with a stale cookie set the new cookie, then the hook cleared it.
  it('keeps a new session cookie that the route sets', async () => {
    h = await createHarness();
    const fresh = 'srep_session=new; Path=/; Max-Age=60; HttpOnly; SameSite=Strict';
    const resolve = vi.fn(
      async () => new Response('{}', { status: 200, headers: { 'set-cookie': fresh } }),
    );
    const event = makeEvent('/api/auth/recovery/login', {
      method: 'POST',
      headers: { origin: ORIGIN },
      cookie: 'stale',
    });
    const response = await handleAuth(h.deps, event, resolve);
    expect(response.headers.getSetCookie()).toEqual([fresh]);
  });
});

// Every M2 and M3 route needs a session (CWE-862, ASVS V4). No route is in the public list.
describe('unauthenticated access to the domain routes', () => {
  const ID = '123e4567-e89b-42d3-a456-426614174000';
  const SHA = '0'.repeat(64);
  const routes: [string, string][] = [
    ['GET', '/api/decks'],
    ['POST', '/api/decks'],
    ['GET', `/api/decks/${ID}`],
    ['PATCH', `/api/decks/${ID}`],
    ['DELETE', `/api/decks/${ID}`],
    ['GET', `/api/decks/${ID}/impact`],
    ['GET', '/api/presets'],
    ['POST', '/api/presets'],
    ['PUT', `/api/presets/${ID}`],
    ['DELETE', `/api/presets/${ID}`],
    ['GET', '/api/note-types'],
    ['POST', '/api/note-types'],
    ['GET', `/api/note-types/${ID}`],
    ['DELETE', `/api/note-types/${ID}`],
    ['POST', '/api/notes'],
    ['GET', `/api/notes/${ID}`],
    ['PATCH', `/api/notes/${ID}`],
    ['DELETE', `/api/notes/${ID}`],
    ['POST', `/api/notes/${ID}/restore`],
    ['POST', '/api/cards/move'],
    ['POST', '/api/media'],
    ['GET', `/api/media/${SHA}`],
    ['GET', '/api/study/next'],
    ['GET', `/api/study/next?deckId=${ID}`],
    ['POST', '/api/study/answer'],
    ['POST', '/api/study/undo'],
    ['GET', '/api/study/verify'],
    ['POST', '/api/study/rebuild'],
    ['POST', '/api/cards/suspend'],
    ['POST', '/api/cards/unsuspend'],
    ['POST', '/api/cards/bury'],
    ['GET', '/api/settings/study'],
    ['PUT', '/api/settings/study'],
  ];

  it.each(routes)('%s %s returns 401 without a session', async (method, path) => {
    h = await createHarness();
    const headers = { origin: ORIGIN, 'content-type': 'application/json' };
    const { response, resolve } = await run(path, { method, headers });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthenticated' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('keeps a cache-control header that an API route sets', async () => {
    h = await createHarness();
    const { cookie } = await signedIn();
    const policy = 'private, max-age=31536000, immutable';
    const resolve = vi.fn(
      async () => new Response('x', { status: 200, headers: { 'cache-control': policy } }),
    );
    const response = await handleAuth(h.deps, makeEvent(`/api/media/${SHA}`, { cookie }), resolve);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(policy);
  });
});

describe('page redirects', () => {
  it('redirects to /setup before setup and to /login after', async () => {
    h = await createHarness();
    const before = await run('/');
    expect(before.response.status).toBe(303);
    expect(before.response.headers.get('location')).toBe('/setup');
    await doSetup(h);
    const after = await run('/');
    expect(after.response.headers.get('location')).toBe('/login');
    expect(after.resolve).not.toHaveBeenCalled();
  });

  it('shows /login and /setup to guests', async () => {
    h = await createHarness();
    expect((await run('/login')).response.status).toBe(200);
    expect((await run('/setup')).response.status).toBe(200);
  });

  it('sends a signed-in user from /login and /setup to /', async () => {
    h = await createHarness();
    const { cookie } = await signedIn();
    for (const path of ['/login', '/setup']) {
      const { response } = await run(path, { cookie });
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/');
    }
    expect((await run('/', { cookie })).response.status).toBe(200);
  });

  it('exposes the session in locals without the raw token', async () => {
    h = await createHarness();
    const { cookie, csrf } = await signedIn();
    const { event } = await run('/', { cookie });
    expect(event.locals.session?.csrfToken).toBe(csrf);
    expect(JSON.stringify(event.locals.session)).not.toContain(cookie);
  });

  it('never blocks /healthz or /_app files', async () => {
    h = await createHarness();
    for (const path of ['/healthz', '/_app/immutable/x.js']) {
      const { response, resolve } = await run(path);
      expect(response.status).toBe(200);
      expect(resolve).toHaveBeenCalledOnce();
    }
  });

  it('redirects GET /gallery to /setup before setup', async () => {
    h = await createHarness();
    const before = await run('/gallery');
    expect(before.response.status).toBe(303);
    expect(before.response.headers.get('location')).toBe('/setup');
    expect(before.resolve).not.toHaveBeenCalled();
  });

  it('redirects GET /gallery to /login after setup', async () => {
    h = await createHarness();
    await doSetup(h);
    const after = await run('/gallery');
    expect(after.response.status).toBe(303);
    expect(after.response.headers.get('location')).toBe('/login');
    expect(after.resolve).not.toHaveBeenCalled();
  });

  it('runs the resolver for GET /gallery with a session cookie', async () => {
    h = await createHarness();
    const { cookie } = await signedIn();
    const { response, resolve } = await run('/gallery', { cookie });
    expect(response.status).toBe(200);
    expect(resolve).toHaveBeenCalled();
  });

  it('keeps the /healthz cache-control header', async () => {
    h = await createHarness();
    const resolve = async () =>
      new Response('ok', { headers: { 'cache-control': 'no-store, max-age=0' } });
    const response = await handleAuth(h.deps, makeEvent('/healthz'), resolve);
    expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('origin and CSRF checks', () => {
  it.each([[undefined], ['http://evil.example'], ['http://localhost:3000.evil.com']])(
    'rejects a public POST with origin %j',
    async (origin) => {
      h = await createHarness();
      const headers: Record<string, string> = origin === undefined ? {} : { origin };
      const { response, resolve } = await run('/api/auth/login/options', {
        method: 'POST',
        headers,
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'bad_origin' });
      expect(resolve).not.toHaveBeenCalled();
    },
  );

  it('needs only the origin for a public POST', async () => {
    h = await createHarness();
    const { response } = await run('/api/auth/login/options', {
      method: 'POST',
      headers: { origin: ORIGIN },
    });
    expect(response.status).toBe(200);
  });

  it('rejects a session POST without or with a wrong CSRF header', async () => {
    h = await createHarness();
    const { cookie } = await signedIn();
    const cases: Record<string, string>[] = [
      { origin: ORIGIN },
      { origin: ORIGIN, 'x-srep-csrf': 'wrong' },
      { origin: ORIGIN, 'x-srep-csrf': csrfTokenFor('another') },
    ];
    for (const headers of cases) {
      const { response } = await run('/api/auth/logout', { method: 'POST', headers, cookie });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'bad_csrf' });
    }
  });

  it('rejects a session POST with a wrong origin before the CSRF check', async () => {
    h = await createHarness();
    const { cookie, csrf } = await signedIn();
    const { response } = await run('/api/auth/logout', {
      method: 'POST',
      headers: { origin: 'http://evil.example', 'x-srep-csrf': csrf },
      cookie,
    });
    expect(await response.json()).toEqual({ error: 'bad_origin' });
  });

  it('passes a session POST with a good origin and CSRF header', async () => {
    h = await createHarness();
    const { cookie, csrf } = await signedIn();
    const { response, resolve } = await run('/api/auth/logout', {
      method: 'POST',
      headers: { origin: ORIGIN, 'x-srep-csrf': csrf },
      cookie,
    });
    expect(response.status).toBe(200);
    expect(resolve).toHaveBeenCalledOnce();
  });

  it('checks the origin of a form POST to a page', async () => {
    h = await createHarness();
    const { cookie } = await signedIn();
    const bad = await run('/', {
      method: 'POST',
      cookie,
      headers: { origin: 'http://evil.example' },
    });
    expect(bad.response.status).toBe(403);
    const good = await run('/', { method: 'POST', cookie, headers: { origin: ORIGIN } });
    expect(good.response.status).toBe(200);
  });

  // Regression: SvelteKit routes "/%61pi/..." to "/api/...". The guard must apply too.
  it('rejects a session POST to a percent-encoded API path without a CSRF header', async () => {
    h = await createHarness();
    const { cookie, csrf } = await signedIn();
    const bad = await run('/%61pi/auth/logout-all', {
      method: 'POST',
      headers: { origin: ORIGIN },
      cookie,
    });
    expect(bad.response.status).toBe(403);
    expect(await bad.response.json()).toEqual({ error: 'bad_csrf' });
    expect(bad.resolve).not.toHaveBeenCalled();
    const good = await run('/%61pi/auth/logout-all', {
      method: 'POST',
      headers: { origin: ORIGIN, 'x-srep-csrf': csrf },
      cookie,
    });
    expect(good.response.status).toBe(200);
    expect(good.response.headers.get('cache-control')).toBe('no-store');
  });
});

// Kit decodes the path before it finds the route. The guard must see the same path.
describe('percent-encoded paths (CWE-863, CWE-352)', () => {
  it('returns 401 for an encoded API path without a session', async () => {
    h = await createHarness();
    const { response, resolve } = await run('/%61pi/auth/credentials');
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthenticated' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('checks the CSRF header on an encoded API path', async () => {
    h = await createHarness();
    const { cookie } = await signedIn();
    const { response, resolve } = await run('/%61pi/auth/logout-all', {
      method: 'POST',
      headers: { origin: ORIGIN },
      cookie,
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'bad_csrf' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('sets no-store on an encoded API path', async () => {
    h = await createHarness();
    const { cookie } = await signedIn();
    const { response } = await run('/%61pi/auth/credentials', { cookie });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('keeps an encoded slash out of the public list', async () => {
    h = await createHarness();
    const { response } = await run('/api/auth/status%2f');
    expect(response.status).toBe(401);
  });

  it('returns 400 for a path that cannot be decoded', async () => {
    h = await createHarness();
    const { response, resolve } = await run('/api/%E0%A4%A');
    expect(response.status).toBe(400);
    expect(resolve).not.toHaveBeenCalled();
  });
});

// Kit runs remote functions at /_app/remote/<id>. They must not skip the guard.
describe('remote function paths (CWE-863)', () => {
  it('does not let an unauthenticated remote call reach the app', async () => {
    h = await createHarness();
    const { response, resolve } = await run('/_app/remote/abc123/getSecret');
    expect(resolve).not.toHaveBeenCalled();
    expect(response.status).toBe(401);
  });

  it('checks origin and CSRF on a signed-in remote call', async () => {
    h = await createHarness();
    const { cookie, csrf } = await signedIn();
    const noCsrf = await run('/_app/remote/abc123/doIt', {
      method: 'POST',
      headers: { origin: ORIGIN },
      cookie,
    });
    expect(noCsrf.response.status).toBe(403);
    const good = await run('/_app/remote/abc123/doIt', {
      method: 'POST',
      headers: { origin: ORIGIN, 'x-srep-csrf': csrf },
      cookie,
    });
    expect(good.resolve).toHaveBeenCalledOnce();
  });

  it('still serves static app files without a session', async () => {
    h = await createHarness();
    const { resolve } = await run('/_app/immutable/entry/start.js');
    expect(resolve).toHaveBeenCalledOnce();
  });
});

describe('response headers', () => {
  it('adds the security headers to every response', async () => {
    h = await createHarness();
    for (const path of ['/login', '/api/zzz', '/']) {
      const { response } = await run(path);
      expect(response.headers.get('x-frame-options')).toBe('DENY');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('strict-transport-security')).toBeNull();
    }
  });

  it('adds HSTS and the __Host- cookie name for an https origin', async () => {
    h = await createHarness({ SREP_ORIGIN: 'https://srep.example.com' });
    const url = new URL('https://srep.example.com/login');
    const event = {
      url,
      request: new Request(url),
      cookies: { get: (name: string) => (name === '__Host-srep_session' ? 'junk' : undefined) },
      locals: { session: null },
    } as unknown as RequestEvent;
    const response = await handleAuth(h.deps, event, async () => new Response('x'));
    expect(response.headers.get('strict-transport-security')).toContain('max-age=31536000');
    expect(response.headers.get('set-cookie')).toContain('__Host-srep_session=;');
    expect(response.headers.get('set-cookie')).toContain('Secure');
  });
});
