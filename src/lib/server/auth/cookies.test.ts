import { describe, expect, it } from 'vitest';
import {
  clearCookieHeader,
  sessionCookieName,
  sessionCookieOptions,
} from '#lib/server/auth/cookies.js';

describe('cookies', () => {
  it('uses the __Host- prefix only when secure', () => {
    expect(sessionCookieName(true)).toBe('__Host-srep_session');
    expect(sessionCookieName(false)).toBe('srep_session');
  });

  it('sets strict options and no domain', () => {
    const options = sessionCookieOptions(true, 60);
    expect(options).toEqual({
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 60,
    });
    expect('domain' in options).toBe(false);
  });

  it('builds a clear header that fits the cookie rules', () => {
    expect(clearCookieHeader(true)).toBe(
      '__Host-srep_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict; Secure',
    );
    expect(clearCookieHeader(false)).toBe(
      'srep_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict',
    );
  });
});
