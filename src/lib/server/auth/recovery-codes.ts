import crypto from 'node:crypto';
import { safeEqual, type RandomBytes } from '#lib/server/auth/tokens.js';

// Crockford base32 without I, L, O and U.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 10;
const SCRYPT = { N: 16384, r: 8, p: 1 } as const;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

function randomCode(random: RandomBytes): string {
  const bytes = random(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    // 256 is a multiple of 32, so the modulo has no bias.
    out += ALPHABET[(bytes[i] ?? 0) % ALPHABET.length];
  }
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

export function generateRecoveryCodes(
  count = 10,
  random: RandomBytes = crypto.randomBytes,
): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    codes.add(randomCode(random));
  }
  return [...codes];
}

export function normalizeRecoveryCode(input: string): string | null {
  const mapped = input
    .trim()
    .toUpperCase()
    .replace(/[-\s]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  if (mapped.length !== CODE_LENGTH) {
    return null;
  }
  for (const char of mapped) {
    if (!ALPHABET.includes(char)) {
      return null;
    }
  }
  return mapped;
}

function scrypt(code: string, salt: Buffer): Buffer {
  return crypto.scryptSync(code, salt, KEY_BYTES, SCRYPT);
}

export function hashRecoveryCode(code: string, salt?: Buffer): string {
  const normalized = normalizeRecoveryCode(code);
  if (normalized === null) {
    throw new Error('invalid recovery code format');
  }
  const useSalt = salt ?? crypto.randomBytes(SALT_BYTES);
  const hash = scrypt(normalized, useSalt);
  return `scrypt$${useSalt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyRecoveryCode(code: string, stored: string): boolean {
  const normalized = normalizeRecoveryCode(code);
  const parts = stored.split('$');
  if (normalized === null || parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }
  const salt = Buffer.from(parts[1] ?? '', 'base64url');
  const expected = Buffer.from(parts[2] ?? '', 'base64url').toString('base64url');
  return safeEqual(scrypt(normalized, salt).toString('base64url'), expected);
}
