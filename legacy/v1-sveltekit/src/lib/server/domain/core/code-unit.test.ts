import { describe, expect, it } from 'vitest';
import { compareCodeUnit, groupNoteTags } from '#lib/server/domain/core/code-unit.js';

describe('compareCodeUnit', () => {
  it('orders by code unit', () => {
    expect(compareCodeUnit('a', 'b')).toBe(-1);
    expect(compareCodeUnit('b', 'a')).toBe(1);
    expect(compareCodeUnit('a', 'a')).toBe(0);
  });
});

describe('groupNoteTags', () => {
  it('keeps an empty list for an id with no row', () => {
    const map = groupNoteTags(
      ['n1', 'n2'],
      [
        { noteId: 'n2', tag: 'plants' },
        { noteId: 'missing', tag: 'skip' },
      ],
    );
    expect(map.get('n1')).toEqual([]);
    expect(map.get('n2')).toEqual(['plants']);
    expect(map.has('missing')).toBe(false);
  });
});
