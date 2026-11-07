import { json, type RequestEvent } from '@sveltejs/kit';
import {
  checkCsrfHeader,
  checkOrigin,
  decodeRoutePath,
  isApiPath,
  isMutating,
  isOriginExemptPublicRoute,
  isPublicApiRoute,
} from '#lib/server/auth/api-guard.js';
import { readBearerToken, resolveApiToken } from '#lib/server/auth/api-tokens.js';
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

function checkMutation(
  deps: AuthDeps,
  event: RequestEvent,
  requiresSession: boolean,
  rawToken: string | undefined,
  path: string,
): Response | null {
  const kind = event.locals.session?.kind;
  if (kind === 'bearer') {
    return null;
  }
  const method = event.request.method;
  if (isOriginExemptPublicRoute(method, path)) {
    return null;
  }
  if (!checkOrigin(event.request.headers.get('origin'), deps.auth.origin)) {
    return json({ error: 'bad_origin' }, { status: 403 });
  }
  const csrf = event.request.headers.get(CSRF_HEADER);
  if (requiresSession && !checkCsrfHeader(csrf, rawToken ?? '')) {
    return json({ error: 'bad_csrf' }, { status: 403 });
  }
  return null;
}

async function checkRoute(
  deps: AuthDeps,
  event: RequestEvent,
  path: string,
  rawToken: string | undefined,
): Promise<Response | null> {
  const method = event.request.method;
  const signedIn = event.locals.session !== null;
  if (isApiPath(path)) {
    const isPublic = isPublicApiRoute(method, path) && path === event.url.pathname;
    if (!isPublic && !signedIn) {
      return json({ error: 'unauthenticated' }, { status: 401 });
    }
    if (isMutating(method)) {
      return checkMutation(deps, event, !isPublic, rawToken, path);
    }
    return null;
  }
  if (isMutating(method)) {
    const rejected = checkMutation(deps, event, false, rawToken, path);
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
  if (isApiPath(path) && !response.headers.has('cache-control')) {
    response.headers.set('cache-control', 'no-store');
  }
  const prefix = `${sessionCookieName(deps.auth.secureCookies)}=`;
  if (clear && !response.headers.getSetCookie().some((line) => line.startsWith(prefix))) {
    response.headers.append('set-cookie', clearCookieHeader(deps.auth.secureCookies));
  }
  return response;
}

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
  if (path === '/healthz' || (path.startsWith('/_app/') && !isApiPath(path))) {
    return finish(deps, path, await resolve(event), false);
  }

  const bearer = readBearerToken(event.request.headers.get('authorization'));
  if (bearer !== null && isApiPath(path)) {
    const tokenRow = await resolveApiToken(deps, bearer);
    if (tokenRow !== null) {
      event.locals.session = { id: tokenRow.id, csrfToken: '', kind: 'bearer' };
      const rejected = await checkRoute(deps, event, path, undefined);
      return finish(deps, path, rejected ?? (await resolve(event)), false);
    }
    if (isMutating(event.request.method) || !isPublicApiRoute(event.request.method, path)) {
      const isPublic = isPublicApiRoute(event.request.method, path) && path === event.url.pathname;
      if (!isPublic) {
        return finish(deps, path, json({ error: 'unauthenticated' }, { status: 401 }), false);
      }
    }
  }

  const rawToken = event.cookies.get(sessionCookieName(deps.auth.secureCookies));
  const row = rawToken === undefined ? null : await resolveSession(deps, rawToken);
  if (row !== null && rawToken !== undefined) {
    event.locals.session = { id: row.id, csrfToken: csrfTokenFor(rawToken), kind: 'cookie' };
  }
  const clear = rawToken !== undefined && row === null;
  const rejected = await checkRoute(deps, event, path, rawToken);
  return finish(deps, path, rejected ?? (await resolve(event)), clear);
}
