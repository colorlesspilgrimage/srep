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

export function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

// SvelteKit routes on the decoded path. For example, "/%61pi/x" goes to "/api/x".
// The guard must see that path too, or encoded paths skip it (CWE-863).
function decodeRoutePath(pathname: string): string {
  try {
    return pathname.split('%25').map(decodeURI).join('%25');
  } catch {
    return pathname;
  }
}

// True when the raw path or the path that SvelteKit routes on is an API path.
export function isApiRequestPath(pathname: string): boolean {
  return isApiPath(pathname) || isApiPath(decodeRoutePath(pathname));
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
