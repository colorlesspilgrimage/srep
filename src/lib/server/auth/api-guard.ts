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
