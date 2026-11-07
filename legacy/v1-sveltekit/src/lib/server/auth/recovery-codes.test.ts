import { describe, expect, it } from 'vitest';
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
  verifyRecoveryCode,
} from '#lib/server/auth/recovery-codes.js';

describe('recovery codes', () => {
  it('makes 10 unique codes in the right format', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
    }
  });

  it('keeps going when the random source repeats a code', () => {
    let calls = 0;
    const random = (size: number): Buffer => {
      calls += 1;
      return Buffer.alloc(size, calls <= 2 ? 1 : calls);
    };
    expect(new Set(generateRecoveryCodes(2, random)).size).toBe(2);
  });

  it.each([
    ['abcde-fghjk', 'ABCDEFGHJK'],
    ['abcde fghjk', 'ABCDEFGHJK'],
    ['  ABCDEFGHJK  ', 'ABCDEFGHJK'],
    ['OOOOO-IIIII', '00000' + '11111'],
    ['LLLLL-lllll', '1111111111'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeRecoveryCode(input)).toBe(expected);
  });

  it.each(['ABCDEFGHJ', 'ABCDEFGHJKM', '', 'ABCDE-FGHJ!', 'ABCDE-FGHJU'])('rejects %j', (input) => {
    expect(normalizeRecoveryCode(input)).toBeNull();
  });

  it('hashes and verifies a code', () => {
    const stored = hashRecoveryCode('ABCDE-FGHJK');
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(stored).not.toContain('ABCDE');
    expect(verifyRecoveryCode('abcde-fghjk', stored)).toBe(true);
    expect(verifyRecoveryCode('ABCDE-FGHJM', stored)).toBe(false);
    expect(verifyRecoveryCode('short', stored)).toBe(false);
  });

  it('uses a new salt for each hash', () => {
    expect(hashRecoveryCode('ABCDE-FGHJK')).not.toBe(hashRecoveryCode('ABCDE-FGHJK'));
  });

  it('uses the salt that the caller gives', () => {
    const salt = Buffer.alloc(16, 7);
    expect(hashRecoveryCode('ABCDE-FGHJK', salt)).toBe(hashRecoveryCode('ABCDE-FGHJK', salt));
  });

  it('refuses to hash a malformed code and to verify a malformed hash', () => {
    expect(() => hashRecoveryCode('bad')).toThrow();
    expect(verifyRecoveryCode('ABCDE-FGHJK', 'plain')).toBe(false);
    expect(verifyRecoveryCode('ABCDE-FGHJK', 'md5$a$b')).toBe(false);
  });
});
