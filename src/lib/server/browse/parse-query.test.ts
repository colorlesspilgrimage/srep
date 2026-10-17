import { describe, expect, it } from 'vitest';
import { parseBrowseQuery } from '#lib/server/browse/parse-query.js';
import type { BrowseQuery } from '#lib/server/browse/types.js';

const bad = { ok: false, error: 'bad_query' } as const;

function query(patch: Partial<BrowseQuery> = {}): { ok: true; query: BrowseQuery } {
  return {
    ok: true,
    query: { decks: [], tags: [], is: [], props: [], texts: [], ...patch },
  };
}

describe('parseBrowseQuery', () => {
  it('parses deck, tag, is, prop, free text, and quoted text', () => {
    expect(parseBrowseQuery('deck:Spanish::Verbs')).toEqual(query({ decks: ['Spanish::Verbs'] }));
    expect(parseBrowseQuery('tag:animals')).toEqual(query({ tags: ['animals'] }));
    expect(parseBrowseQuery('tag:ANIMALS')).toEqual(query({ tags: ['animals'] }));
    expect(parseBrowseQuery('tag:"lang::ja"')).toEqual(query({ tags: ['lang::ja'] }));
    expect(parseBrowseQuery('is:due')).toEqual(query({ is: ['due'] }));
    expect(parseBrowseQuery('is:new')).toEqual(query({ is: ['new'] }));
    expect(parseBrowseQuery('is:suspended')).toEqual(query({ is: ['suspended'] }));
    expect(parseBrowseQuery('prop:lapses>3')).toEqual(query({ props: [{ op: '>', value: 3 }] }));
    expect(parseBrowseQuery('prop:lapses>=3')).toEqual(query({ props: [{ op: '>=', value: 3 }] }));
    expect(parseBrowseQuery('prop:lapses<3')).toEqual(query({ props: [{ op: '<', value: 3 }] }));
    expect(parseBrowseQuery('prop:lapses<=3')).toEqual(query({ props: [{ op: '<=', value: 3 }] }));
    expect(parseBrowseQuery('prop:lapses=0')).toEqual(query({ props: [{ op: '=', value: 0 }] }));
    expect(parseBrowseQuery('prop:lapses>1000000')).toEqual(
      query({ props: [{ op: '>', value: 1_000_000 }] }),
    );
    expect(parseBrowseQuery('gato')).toEqual(query({ texts: ['gato'] }));
    expect(parseBrowseQuery('"hello world"')).toEqual(query({ texts: ['hello world'] }));
    expect(parseBrowseQuery('"deck:Spanish"')).toEqual(query({ texts: ['deck:Spanish'] }));
    expect(parseBrowseQuery('deck:"My Deck"')).toEqual(query({ decks: ['My Deck'] }));
    expect(parseBrowseQuery('is:new is:suspended')).toEqual(query({ is: ['new', 'suspended'] }));
  });

  it('rejects a bad prop, a bad is, 9 tokens, 501 characters, and odd quotes', () => {
    for (const input of [
      'prop:lapses!',
      'prop:lapses>1000001',
      'prop:lapses>-1',
      'prop:lapses>1.5',
      'prop:ease>1',
      'prop:lapses>',
      'is:learning',
      'is:DUE',
      'tag:',
      'deck:',
      'is:',
      'prop:',
      '""',
      '"',
      'a"b',
      'a'.repeat(501),
      Array.from({ length: 9 }, (_, i) => `t${i}`).join(' '),
      'gato\u0000',
    ]) {
      expect(parseBrowseQuery(input), input).toEqual(bad);
    }
    expect(parseBrowseQuery('a'.repeat(500)).ok).toBe(true);
    expect(parseBrowseQuery(Array.from({ length: 8 }, (_, i) => `t${i}`).join(' ')).ok).toBe(true);
    expect(parseBrowseQuery('   ').ok).toBe(true);
    expect(parseBrowseQuery('deck:Spanish\u00a0')).toEqual(query({ decks: ['Spanish'] }));
    expect(parseBrowseQuery('deck:"  Spanish  "')).toEqual(query({ decks: ['Spanish'] }));
    expect(parseBrowseQuery('deck:"   "')).toEqual(bad);
  });

  it('does not throw on a long or malformed query', () => {
    const inputs = [
      'prop:lapses>' + '1'.repeat(400),
      'deck:' + '%_\\'.repeat(80),
      'tag:' + 'é'.repeat(80),
      '\u0000',
      String.fromCharCode(0xd800),
      '"'.repeat(500),
      '((((',
      '.*+',
    ];
    for (const input of inputs) {
      expect(() => parseBrowseQuery(input)).not.toThrow();
    }
  });
});
