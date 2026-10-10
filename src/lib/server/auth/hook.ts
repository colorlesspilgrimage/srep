import { json, type RequestEvent } from '@sveltejs/kit';
import {
  checkCsrfHeader,
  checkOrigin,
  decodeRoutePath,
  isApiPath,
  isMutating,
  isPublicApiRoute,
} from '#lib/server/auth/api-guard.js';
import { clearCookieHeader, sessionCookieName } from '#lib/server/auth/cookies.js';
import type { AuthDeps } from '#lib/server/auth/deps.js';
import { badRequest } from '#lib/server/auth/http.js';
import { buildSecurityHeaders } from '#lib/server/auth/security-headers.js';
import { resolveSession } from '#lib/server/auth/sessions.js';
import { csrfTokenFor } from '#lib/server/auth/tokens.js';

type Resolve = (event: RequestEvent) => Response | Promise<Response>;

const CSRF_HEADER = 'x-srep-csrf';
const GUEST_PAGES = ['/login', '/setup'];

function redirectTo(location: string): Response {
  return new Response(null, { status: 303, headers: { location } });
}

// Checks the Origin header, and the CSRF header when the route needs a session.
function checkMutation(
  deps: AuthDeps,
  event: RequestEvent,
  requiresSession: boolean,
  rawToken: string | undefined,
): Response | null {
  if (!checkOrigin(event.request.headers.get('origin'), deps.auth.origin)) {
    return json({ error: 'bad_origin' }, { status: 403 });
  }
  const csrf = event.request.headers.get(CSRF_HEADER);
  if (requiresSession && !checkCsrfHeader(csrf, rawToken ?? '')) {
    return json({ error: 'bad_csrf' }, { status: 403 });
  }
  return null;
}

// The path is the decoded path that SvelteKit uses to find the route.
async function checkRoute(
  deps: AuthDeps,
  event: RequestEvent,
  path: string,
  rawToken: string | undefined,
): Promise<Response | null> {
  const method = event.request.method;
  const signedIn = event.locals.session !== null;
  if (isApiPath(path)) {
    // Public routes match the raw path too, so an encoded spelling needs a session (CWE-863).
    const isPublic = isPublicApiRoute(method, path) && path === event.url.pathname;
    if (!isPublic && !signedIn) {
      return json({ error: 'unauthenticated' }, { status: 401 });
    }
    if (isMutating(method)) {
      return checkMutation(deps, event, !isPublic, rawToken);
    }
    return null;
  }
  if (isMutating(method)) {
    const rejected = checkMutation(deps, event, false, rawToken);
    if (rejected !== null) {
      return rejected;
    }
  }
  const isGuestPage = GUEST_PAGES.includes(path);
  if (signedIn && isGuestPage) {
    return redirectTo('/');
  }
  if (!signedIn && !isGuestPage) {
    return redirectTo((await deps.store.isSetupComplete()) ? '/login' : '/setup');
  }
  return null;
}

function finish(deps: AuthDeps, path: string, response: Response, clear: boolean): Response {
  for (const [name, value] of Object.entries(buildSecurityHeaders(deps.auth))) {
    response.headers.set(name, value);
  }
  if (isApiPath(path)) {
    response.headers.set('cache-control', 'no-store');
  }
  // A login route can set a new session cookie in the same response. The browser applies
  // Set-Cookie lines in order, so a later clear line would delete the new session.
  const prefix = `${sessionCookieName(deps.auth.secureCookies)}=`;
  if (clear && !response.headers.getSetCookie().some((line) => line.startsWith(prefix))) {
    response.headers.append('set-cookie', clearCookieHeader(deps.auth.secureCookies));
  }
  return response;
}

// Loads the session, applies the guards, and adds the security headers.
export async function handleAuth(
  deps: AuthDeps,
  event: RequestEvent,
  resolve: Resolve,
): Promise<Response> {
  event.locals.session = null;
  const path = decodeRoutePath(event.url.pathname);
  if (path === null) {
    return finish(deps, event.url.pathname, badRequest(), false);
  }
  // Static app files and the health check need no session. Remote functions do.
  if (path === '/healthz' || (path.startsWith('/_app/') && !isApiPath(path))) {
    return finish(deps, path, await resolve(event), false);
  }
  const rawToken = event.cookies.get(sessionCookieName(deps.auth.secureCookies));
  const row = rawToken === undefined ? null : await resolveSession(deps, rawToken);
  if (row !== null && rawToken !== undefined) {
    event.locals.session = { id: row.id, csrfToken: csrfTokenFor(rawToken) };
  }
  const clear = rawToken !== undefined && row === null;
  const rejected = await checkRoute(deps, event, path, rawToken);
  return finish(deps, path, rejected ?? (await resolve(event)), clear);
}
