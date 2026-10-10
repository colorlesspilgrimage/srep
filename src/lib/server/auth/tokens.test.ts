import { describe, expect, it } from 'vitest';
import { csrfTokenFor, randomToken, safeEqual, sha256Hex } from '#lib/server/auth/tokens.js';

describe('tokens', () => {
  it('makes base64url tokens of the right length', () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken(16)).toHaveLength(22);
    expect(randomToken()).not.toBe(token);
  });

  it('uses the injected random source', () => {
    expect(randomToken(3, () => Buffer.from([1, 2, 3]))).toBe('AQID');
  });

  it('hashes to hex', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('compares strings in constant time without a length error', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });

  it('derives a stable CSRF token that hides the session token', () => {
    const raw = 'raw-session-token';
    expect(csrfTokenFor(raw)).toBe(csrfTokenFor(raw));
    expect(csrfTokenFor(raw)).not.toBe(csrfTokenFor('other'));
    expect(csrfTokenFor(raw)).not.toContain(raw);
  });
});
