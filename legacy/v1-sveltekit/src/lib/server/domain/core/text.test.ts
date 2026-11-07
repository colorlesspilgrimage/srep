import { describe, expect, it } from 'vitest';
import { fieldChecksum, isBlank, sha256Hex, stripTags } from '#lib/server/domain/core/text.js';

describe('stripTags', () => {
  it('removes tags and keeps an unclosed <', () => {
    expect(stripTags('<b>bold</b> <img src="x">text')).toBe('bold text');
    expect(stripTags('a < b')).toBe('a < b');
    expect(stripTags('<'.repeat(50_000))).toBe('<'.repeat(50_000));
  });
});

describe('isBlank', () => {
  it.each([
    ['', true],
    ['   ', true],
    ['<br>', true],
    ['&nbsp;<div> </div>', true],
    ['x', false],
    ['<b>x</b>', false],
  ])('%j gives %s', (text, blank) => {
    expect(isBlank(text)).toBe(blank);
  });
});

describe('fieldChecksum', () => {
  it('hashes the field without tags and outer space', () => {
    expect(fieldChecksum(' <b>dog</b> ')).toBe(sha256Hex('dog'));
    expect(fieldChecksum('dog')).toMatch(/^[0-9a-f]{64}$/);
  });
});
