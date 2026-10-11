import type { RandomBytes } from '#lib/server/auth/tokens.js';

// A UUID v4 from 16 random bytes. A seeded source gives the same id in every run.
export function newId(random: RandomBytes): string {
  const b = random(16);
  b[6] = ((b[6] as number) & 0x0f) | 0x40;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  const hex = b.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
