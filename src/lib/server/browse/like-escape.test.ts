import { describe, expect, it } from 'vitest';
import { escapeLike, asciiLower } from '#lib/server/browse/like-escape.js';

describe('escapeLike', () => {
  it('escapes backslash, percent, and underscore', () => {
    expect(escapeLike('100%_')).toBe('100\\%\\_');
    expect(escapeLike('\\')).toBe('\\\\');
    expect(escapeLike('\\%_')).toBe('\\\\\\%\\_');
    expect(escapeLike('gato')).toBe('gato');
  });
});

describe('asciiLower', () => {
  it('folds A to Z and leaves other letters', () => {
    expect(asciiLower('GATO')).toBe('gato');
    expect(asciiLower('Á')).toBe('Á');
    expect(asciiLower('a1')).toBe('a1');
  });
});
