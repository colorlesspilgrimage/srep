import { describe, expect, it } from 'vitest';
import { frontTextOf, tagsByNote, toBrowsePage } from '#lib/server/browse/browse-page.js';
import type { BrowseRawRow } from '#lib/server/browse/types.js';

function raw(patch: Partial<BrowseRawRow> = {}): BrowseRawRow {
  return {
    cardId: 'c1',
    noteId: 'n1',
    deckId: 'd1',
    deckPath: 'Spanish',
    state: 'new',
    due: 1,
    lapses: 0,
    fields: ['gato'],
    ...patch,
  };
}

describe('frontTextOf', () => {
  it('strips tags, keeps template text, and cuts at 80 code points', () => {
    expect(frontTextOf(['<b>gato</b>'])).toBe('gato');
    expect(frontTextOf(['{{Front}}'])).toBe('{{Front}}');
    expect(frontTextOf([])).toBe('');
    expect(frontTextOf(undefined)).toBe('');
    expect(frontTextOf(['a'.repeat(80)])).toBe('a'.repeat(80));
    expect(frontTextOf(['a'.repeat(81)])).toBe('a'.repeat(80));
    const emoji = `${'a'.repeat(79)}😀b`;
    expect(frontTextOf([emoji])).toBe(`${'a'.repeat(79)}😀`);
  });
});

describe('tagsByNote', () => {
  it('sorts tags by code unit and ignores an unknown note', () => {
    const map = tagsByNote(
      ['n1'],
      [
        { noteId: 'n1', tag: 'b' },
        { noteId: 'n1', tag: 'a' },
        { noteId: 'n1', tag: 'a' },
        { noteId: 'other', tag: 'z' },
      ],
    );
    expect(map.get('n1')).toEqual(['a', 'a', 'b']);
    expect(map.has('other')).toBe(false);
  });
});

describe('toBrowsePage', () => {
  it('returns a cursor only when one more row exists', () => {
    const tags = new Map([['n1', ['animals']]]);
    expect(toBrowsePage([], 50, tags)).toEqual({ rows: [], nextCursor: null });
    const one = toBrowsePage([raw()], 50, tags);
    expect(one.nextCursor).toBeNull();
    expect(one.rows[0]).toMatchObject({ frontText: 'gato', tags: ['animals'], deckId: 'd1' });
    const page = toBrowsePage([raw({ cardId: 'a' }), raw({ cardId: 'b' })], 1, new Map());
    expect(page.rows.map((row) => row.cardId)).toEqual(['a']);
    expect(page.nextCursor).toBe('a');
    expect(page.rows[0]?.tags).toEqual([]);
    const empty = toBrowsePage([raw({ deckId: null })], 0, new Map());
    expect(empty).toEqual({ rows: [], nextCursor: null });
    expect(toBrowsePage([raw({ deckId: null })], 5, new Map()).rows[0]?.deckId).toBe('');
  });
});
