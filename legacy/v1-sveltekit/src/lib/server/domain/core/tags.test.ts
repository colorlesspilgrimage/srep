import { describe, expect, it } from 'vitest';
import { normalizeTags } from '#lib/server/domain/core/tags.js';

describe('normalizeTags', () => {
  it('trims, lowers, removes duplicates and sorts', () => {
    expect(normalizeTags(['  Zoo ', 'animals', 'ANIMALS', 'b'])).toEqual(['animals', 'b', 'zoo']);
    expect(normalizeTags([])).toEqual([]);
  });

  it('allows :: for a hierarchy', () => {
    expect(normalizeTags(['lang::ja'])).toEqual(['lang::ja']);
  });

  it('applies NFC', () => {
    expect(normalizeTags(['cafe\u0301', 'café'])).toEqual(['café']);
  });

  it('checks the length: 100 is valid, 101 and 0 are not', () => {
    expect(normalizeTags(['x'.repeat(100)])).toEqual(['x'.repeat(100)]);
    expect(normalizeTags(['x'.repeat(101)])).toBeNull();
    expect(normalizeTags(['   '])).toBeNull();
  });

  it.each(['a b', 'a\tb', 'a\u0000b', 'a\u0085b'])('refuses %j', (tag) => {
    expect(normalizeTags([tag])).toBeNull();
  });

  it('allows 100 tags and refuses 101', () => {
    const tags = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);
    expect(normalizeTags(tags(100))).toHaveLength(100);
    expect(normalizeTags(tags(101))).toBeNull();
  });
});
