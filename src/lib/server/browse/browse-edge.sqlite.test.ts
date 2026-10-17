import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { searchCards } from '#lib/server/browse/browse.sqlite.js';
import { parseBrowseQuery } from '#lib/server/browse/parse-query.js';
import type { BrowseQuery } from '#lib/server/browse/types.js';
import { BASIC_ID } from '#lib/server/domain/builtin.js';
import { createNote } from '#lib/server/domain/notes.js';
import { execSql } from '#lib/server/domain/store/suite-support.js';
import {
  addDeck,
  createStudyHarness,
  type StudyHarness,
} from '#lib/server/study/test-support/harness.js';

const END = 5_000;

let h: StudyHarness | undefined;

afterEach(async () => {
  await h?.close();
  h = undefined;
});

async function note(deckId: string, fields: string[], tags: string[] = []) {
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

async function fronts(q: string): Promise<string[]> {
  const parsed = parseBrowseQuery(q);
  if (!parsed.ok) throw new Error(q);
  const page = searchCards(db(), parsed.query, END, 50, null);
  return page.rows.map((row) => row.frontText).sort();
}

async function frontsOf(query: BrowseQuery): Promise<string[]> {
  const page = searchCards(db(), query, END, 50, null);
  return page.rows.map((row) => row.frontText).sort();
}

describe('sqlite browse edges', () => {
  it('matches a deck path and its children, and escapes LIKE marks', async () => {
    h = await createStudyHarness();
    const spanish = await addDeck(h, 'Spanish');
    const verbs = await addDeck(h, 'Verbs', { parentId: spanish.id });
    const french = await addDeck(h, 'French');
    const wild = await addDeck(h, '%_');
    const wildChild = await addDeck(h, 'Kid', { parentId: wild.id });
    await note(spanish.id, ['root', 'x']);
    await note(verbs.id, ['child', 'x']);
    await note(french.id, ['other', 'x']);
    await note(wild.id, ['wild', 'x']);
    await note(wildChild.id, ['wild-child', 'x']);
    await note(spanish.id, ['100%_x', 'y']);
    await note(french.id, ['100A_x', 'y']);

    expect(await fronts('deck:Spanish')).toEqual(['100%_x', 'child', 'root']);
    expect(await fronts('deck:Spanish::Verbs')).toEqual(['child']);
    expect(await fronts('deck:span')).toEqual([]);
    expect(await fronts('deck:spanish')).toEqual([]);
    expect(await fronts('deck:%_')).toEqual(['wild', 'wild-child']);
    expect(await frontsOf({ decks: [], tags: [], is: [], props: [], texts: ['100%_x'] })).toEqual([
      '100%_x',
    ]);
    expect(await frontsOf({ decks: [], tags: [], is: [], props: [], texts: ['%'] })).toEqual([
      '100%_x',
    ]);
    expect(await frontsOf({ decks: [], tags: [], is: [], props: [], texts: ['_'] })).toEqual([
      '100%_x',
      '100A_x',
    ]);
  });

  it('excludes a trashed note, an archived deck, and a learning card from is:due', async () => {
    h = await createStudyHarness();
    const live = await addDeck(h, 'Live');
    const archived = await addDeck(h, 'Old');
    const kept = await note(live.id, ['kept', 'x']);
    const gone = await note(live.id, ['gone', 'x']);
    const hidden = await note(archived.id, ['hidden', 'x']);
    const learning = await note(live.id, ['learn', 'x']);
    const late = await note(live.id, ['late', 'x']);
    const due = await note(live.id, ['due', 'x']);
    await h.store.trashNote(gone.noteId, 10);
    await execSql(h, sql`update deck set archived_at = 1 where id = ${archived.id}`);
    await execSql(
      h,
      sql`update card set state = 'learning', due = 0 where id = ${learning.cardId}`,
    );
    await execSql(h, sql`update card set state = 'review', due = ${END} where id = ${late.cardId}`);
    await execSql(
      h,
      sql`update card set state = 'review', due = ${END - 1} where id = ${due.cardId}`,
    );
    expect(await fronts('')).toEqual(['due', 'kept', 'late', 'learn']);
    expect(await fronts('is:due')).toEqual(['due']);
    expect(hidden.cardId).not.toBe(kept.cardId);
  });
});
