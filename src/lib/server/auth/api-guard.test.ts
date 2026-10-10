import { describe, expect, it } from 'vitest';
import {
  checkCsrfHeader,
  checkOrigin,
  decodeRoutePath,
  isApiPath,
  isMutating,
  isPublicApiRoute,
} from '#lib/server/auth/api-guard.js';
import { csrfTokenFor } from '#lib/server/auth/tokens.js';

const PUBLIC: [string, string][] = [
  ['GET', '/api/auth/status'],
  ['POST', '/api/auth/setup/options'],
  ['POST', '/api/auth/setup/verify'],
  ['POST', '/api/auth/login/options'],
  ['POST', '/api/auth/login/verify'],
  ['POST', '/api/auth/recovery/login'],
];

describe('public API routes', () => {
  it.each(PUBLIC)('%s %s is public', (method, path) => {
    expect(isPublicApiRoute(method, path)).toBe(true);
  });

  it('is public for its own method only', () => {
    expect(isPublicApiRoute('GET', '/api/auth/login/verify')).toBe(false);
    expect(isPublicApiRoute('POST', '/api/auth/status')).toBe(false);
    expect(isPublicApiRoute('PUT', '/api/auth/status')).toBe(false);
  });

  it.each([
    '/api/auth/status/',
    '/api//auth/status',
    '/api/auth/status%2f',
    '/api/AUTH/status',
    '/api/auth/%2e/status',
    '/api/decks',
    '/api',
    '/api/',
  ])('%s needs a session', (path) => {
    expect(isPublicApiRoute('GET', path)).toBe(false);
  });
});

describe('path and method helpers', () => {
  it('finds API paths', () => {
    expect(isApiPath('/api')).toBe(true);
    expect(isApiPath('/api/x')).toBe(true);
    expect(isApiPath('/apix')).toBe(false);
    expect(isApiPath('/login')).toBe(false);
  });

  // Regression: SvelteKit decodes the path before it picks a route.
  it('finds percent-encoded API paths', () => {
    const isApi = (raw: string) => isApiPath(decodeRoutePath(raw) ?? '');
    expect(isApi('/%61pi/decks')).toBe(true);
    expect(isApi('/%61%70%69')).toBe(true);
    expect(isApi('/api/x')).toBe(true);
    expect(isApi('/%2561pi/x')).toBe(false);
    expect(isApi('/login')).toBe(false);
    expect(decodeRoutePath('/%E0%A4%A')).toBeNull();
  });

  it('finds mutating methods', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(isMutating(method)).toBe(false);
    }
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(isMutating(method)).toBe(true);
    }
  });
});

describe('checkOrigin', () => {
  const expected = 'http://localhost:3000';
  it('accepts the exact origin', () => {
    expect(checkOrigin(expected, expected)).toBe(true);
  });

  it.each([
    null,
    '',
    'https://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3000.evil.com',
    'http://localhost:3000/',
  ])('rejects %j', (value) => {
    expect(checkOrigin(value, expected)).toBe(false);
  });
});

describe('checkCsrfHeader', () => {
  it('accepts the right value only', () => {
    const header = csrfTokenFor('session-a');
    expect(checkCsrfHeader(header, 'session-a')).toBe(true);
    expect(checkCsrfHeader('', 'session-a')).toBe(false);
    expect(checkCsrfHeader(null, 'session-a')).toBe(false);
    expect(checkCsrfHeader(csrfTokenFor('session-b'), 'session-a')).toBe(false);
  });
});
