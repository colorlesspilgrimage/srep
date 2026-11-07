import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { searchCards } from '#lib/server/browse/browse.sqlite.js';
import { parseBrowseQuery } from '#lib/server/browse/parse-query.js';
import type { BrowsePage, BrowseQuery } from '#lib/server/browse/types.js';
import { BASIC_ID } from '#lib/server/domain/builtin.js';
import { createNote } from '#lib/server/domain/notes.js';
import { countRows, execSql } from '#lib/server/domain/store/suite-support.js';
import { addDeck, type StudyHarness } from '#lib/server/study/test-support/harness.js';
import { createStudyHarness } from '#lib/server/study/test-support/harness.js';

const END = 5_000;

let h: StudyHarness | undefined;

afterEach(async () => {
  await h?.close();
  h = undefined;
});

function emptyQuery(): BrowseQuery {
  return { decks: [], tags: [], is: [], props: [], texts: [] };
}

async function mustNote(deckId: string, fields: string[], tags: string[]) {
  if (h === undefined) throw new Error('no harness');
  const result = await createNote(h.deps, { noteTypeId: BASIC_ID, deckId, fields, tags });
  if (!result.ok) throw new Error(result.error);
  const cardId = result.note.cards[0]?.id;
  if (cardId === undefined) throw new Error('no card');
  return { noteId: result.note.id, cardId };
}

function db() {
  if (h === undefined || h.handle.dialect !== 'sqlite') throw new Error('sqlite harness');
  return h.handle.db;
}

async function search(q: string, limit = 50, cursor: string | null = null): Promise<BrowsePage> {
  const parsed = parseBrowseQuery(q);
  if (!parsed.ok) throw new Error(`bad query ${q}`);
  return searchCards(db(), parsed.query, END, limit, cursor);
}

function fronts(page: BrowsePage): string[] {
  return page.rows.map((row) => row.frontText).sort();
}

describe('sqlite browse search', () => {
  it('matches tag, deck, is, prop, and free text', async () => {
    h = await createStudyHarness();
    const spanish = await addDeck(h, 'Spanish');
    const french = await addDeck(h, 'French');
    const gato = await mustNote(spanish.id, ['<b>gato</b>', 'cat'], ['animals']);
    const chien = await mustNote(french.id, ['chien', 'dog'], ['plants']);
    const perro = await mustNote(spanish.id, ['Perro', 'dog'], ['animals']);
    await execSql(h, sql`update card set state = 'suspended' where id = ${chien.cardId}`);
    await execSql(
      h,
      sql`update card set state = 'review', lapses = 4, due = ${END - 1} where id = ${perro.cardId}`,
    );

    expect(fronts(await search('tag:animals'))).toEqual(['Perro', 'gato']);
    expect(fronts(await search('deck:Spanish'))).toEqual(['Perro', 'gato']);
    expect(fronts(await search('is:new'))).toEqual(['gato']);
    expect(fronts(await search('is:suspended'))).toEqual(['chien']);
    expect(fronts(await search('prop:lapses>3'))).toEqual(['Perro']);
    expect(fronts(await search('gato'))).toEqual(['gato']);
    expect(fronts(await search('GATO'))).toEqual(['gato']);
    expect(fronts(await search('perro'))).toEqual(['Perro']);
    expect(fronts(await search('is:new is:suspended'))).toEqual([]);
    expect(fronts(await search('is:due'))).toEqual(['Perro']);

    const animals = await search('tag:animals');
    const gatoRow = animals.rows.find((row) => row.cardId === gato.cardId);
    expect(gatoRow).toMatchObject({
      noteId: gato.noteId,
      deckId: spanish.id,
      deckPath: 'Spanish',
      state: 'new',
      lapses: 0,
      frontText: 'gato',
      tags: ['animals'],
    });
    expect(gatoRow?.due).toEqual(expect.any(Number));
  });

  it('keeps the note table when the tag value is hostile', async () => {
    h = await createStudyHarness();
    const spanish = await addDeck(h, 'Spanish');
    await mustNote(spanish.id, ['gato', 'cat'], ['animals']);
    const before = await countRows(h, 'note');
    const hostile = `'; drop table note; --`;
    const page = searchCards(db(), { ...emptyQuery(), tags: [hostile] }, END, 50, null);
    expect(page.rows).toEqual([]);
    expect(await countRows(h, 'note')).toBe(before);
    const quoted = await search(`"${hostile}"`);
    expect(quoted.rows).toEqual([]);
    expect(await countRows(h, 'note')).toBe(before);
  });

  it('pages by card id', async () => {
    h = await createStudyHarness();
    const spanish = await addDeck(h, 'Spanish');
    await mustNote(spanish.id, ['a', 'b'], []);
    await mustNote(spanish.id, ['c', 'd'], []);
    await mustNote(spanish.id, ['e', 'f'], []);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 5; i += 1) {
      const page = await search('', 1, cursor);
      seen.push(...page.rows.map((row) => row.cardId));
      if (page.nextCursor === null) break;
      expect(page.rows).toHaveLength(1);
      cursor = page.nextCursor;
    }
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
    expect(seen).toEqual([...seen].sort());
  });
});
