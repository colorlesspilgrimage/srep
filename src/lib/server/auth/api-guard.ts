import { csrfTokenFor, safeEqual } from '#lib/server/auth/tokens.js';

// Exact [method, pathname] pairs. Never match with startsWith (CWE-863).
const PUBLIC_API_ROUTES: readonly (readonly [string, string])[] = [
  ['GET', '/api/auth/status'],
  ['POST', '/api/auth/setup/options'],
  ['POST', '/api/auth/setup/verify'],
  ['POST', '/api/auth/login/options'],
  ['POST', '/api/auth/login/verify'],
  ['POST', '/api/auth/recovery/login'],
];

// SvelteKit remote functions answer here. They return data, so they get the API guard.
export const REMOTE_PREFIX = '/_app/remote/';

// SvelteKit decodes the path in the same way before it finds the route.
// The guard must check that decoded path, or "/%61pi" skips it (CWE-863).
// "%25" stays encoded, so a decoded "%" cannot start a new escape. Returns null on bad input.
export function decodeRoutePath(pathname: string): string | null {
  try {
    return pathname.split('%25').map(decodeURI).join('%25');
  } catch {
    return null;
  }
}

// Paths that get the API guard: /api and its children, and remote functions.
export function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/') || pathname.startsWith(REMOTE_PREFIX);
}

export function isPublicApiRoute(method: string, pathname: string): boolean {
  return PUBLIC_API_ROUTES.some(([m, p]) => m === method && p === pathname);
}

export function isMutating(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}

export function checkOrigin(originHeader: string | null, expectedOrigin: string): boolean {
  return originHeader !== null && originHeader === expectedOrigin;
}

export function checkCsrfHeader(headerValue: string | null, rawSessionToken: string): boolean {
  if (headerValue === null || headerValue === '') {
    return false;
  }
  return safeEqual(headerValue, csrfTokenFor(rawSessionToken));
}
