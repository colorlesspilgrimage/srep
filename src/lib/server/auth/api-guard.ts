import { csrfTokenFor, safeEqual } from '#lib/server/auth/tokens.js';

const PUBLIC_API_ROUTES: readonly (readonly [string, string])[] = [
  ['GET', '/api/auth/status'],
  ['POST', '/api/auth/setup/options'],
  ['POST', '/api/auth/setup/verify'],
  ['POST', '/api/auth/login/options'],
  ['POST', '/api/auth/login/verify'],
  ['POST', '/api/auth/recovery/login'],
  ['POST', '/api/auth/pairing/exchange'],
];

const ORIGIN_EXEMPT_PUBLIC_ROUTES: readonly (readonly [string, string])[] = [
  ['POST', '/api/auth/pairing/exchange'],
];

export const REMOTE_PREFIX = '/_app/remote/';

export function decodeRoutePath(pathname: string): string | null {
  try {
    return pathname.split('%25').map(decodeURI).join('%25');
  } catch {
    return null;
  }
}

export function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/') || pathname.startsWith(REMOTE_PREFIX);
}

export function isPublicApiRoute(method: string, pathname: string): boolean {
  return PUBLIC_API_ROUTES.some(([m, p]) => m === method && p === pathname);
}

export function isOriginExemptPublicRoute(method: string, pathname: string): boolean {
  return ORIGIN_EXEMPT_PUBLIC_ROUTES.some(([m, p]) => m === method && p === pathname);
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
