import { describe, expect, it } from 'vitest';
import { nextClozeIndex, wrapCloze } from './cloze-edit.js';

describe('wrapCloze', () => {
  it('wraps a selection and inserts an empty cloze at the caret', () => {
    expect(wrapCloze('hello gato', 6, 10, 1)).toBe('hello {{c1::gato}}');
    expect(wrapCloze('ab', 1, 1, 2)).toBe('a{{c2::}}b');
    expect(wrapCloze('gato', 0, 4, 999)).toBe('{{c999::gato}}');
  });

  it('returns null for index 0, index 1000, and a bad selection', () => {
    expect(wrapCloze('gato', 0, 4, 0)).toBeNull();
    expect(wrapCloze('gato', 0, 4, 1000)).toBeNull();
    expect(wrapCloze('gato', 0, 4, 1.5)).toBeNull();
    expect(wrapCloze('gato', 3, 1, 1)).toBeNull();
    expect(wrapCloze('gato', -1, 1, 1)).toBeNull();
    expect(wrapCloze('gato', 0, 5, 1)).toBeNull();
    expect(wrapCloze('gato', 1.2, 2, 1)).toBeNull();
  });

  it('wraps text that already contains braces', () => {
    expect(wrapCloze('{{c1::a}}', 0, 8, 2)).toBe('{{c2::{{c1::a}}}}');
  });

  it('returns null when a selection splits a surrogate pair', () => {
    const grin = '\uD83D\uDE00';
    expect(wrapCloze(grin, 0, 1, 1)).toBeNull();
    expect(wrapCloze(grin, 1, 1, 1)).toBeNull();
    expect(wrapCloze(grin, 1, 2, 1)).toBeNull();
    expect(wrapCloze(`a${grin}b`, 2, 2, 1)).toBeNull();
    expect(wrapCloze(grin, 0, 2, 1)).toBe(`{{c1::${grin}}}`);
    expect(wrapCloze(`a${grin}b`, 1, 3, 1)).toBe(`a{{c1::${grin}}}b`);
  });

  it('returns null when the text or the result is above 50000 characters', () => {
    expect(wrapCloze('a'.repeat(50_001), 0, 0, 1)).toBeNull();
    expect(wrapCloze('a'.repeat(49_993), 0, 0, 1)).toBeNull();
    expect(wrapCloze('a'.repeat(49_992), 0, 0, 1)?.length).toBe(50_000);
    expect(wrapCloze('gato', 0, 4, Number.NaN)).toBeNull();
    expect(wrapCloze('gato', 0, 4, Number.POSITIVE_INFINITY)).toBeNull();
    expect(wrapCloze('gato', 0, 4, -1)).toBeNull();
  });
});

describe('nextClozeIndex', () => {
  it('returns 1 for empty text and for text with no cloze', () => {
    expect(nextClozeIndex('')).toBe(1);
    expect(nextClozeIndex('gato')).toBe(1);
    expect(nextClozeIndex('{{c0::no}} {{c1000::no}}')).toBe(1);
  });

  it('returns one more than the highest index and caps at 999', () => {
    expect(nextClozeIndex('{{c1::a}} {{c5::b}}')).toBe(6);
    expect(nextClozeIndex('{{c998::a}}')).toBe(999);
    expect(nextClozeIndex('{{c999::a}}')).toBe(999);
    expect(nextClozeIndex('{{c')).toBe(1);
  });

  it('reads the outer cloze when braces are nested', () => {
    expect(nextClozeIndex('{{c1::{{c2::x}}}}')).toBe(2);
    expect(nextClozeIndex('{{c4::{{c9::x}}}} {{c3::y}}')).toBe(5);
    expect(nextClozeIndex('{{c3::\uD83D\uDE00}}')).toBe(4);
  });

  it('does not scan text above 50000 characters', () => {
    expect(nextClozeIndex(`{{c9::a}}${'b'.repeat(50_000)}`)).toBe(1);
    expect(nextClozeIndex('{{c7::a}}' + 'b'.repeat(49_991))).toBe(8);
  });
});
