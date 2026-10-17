// Contract: live Postgres browse search. Skips when SREP_TEST_POSTGRES_URL is unset.
// LIKE marks stay literal. The fold is A to Z only. A quote does not drop a table.

import { afterEach, describe, expect, it } from 'vitest';
import { searchCards } from '#lib/server/browse/browse.pg.js';
import { parseBrowseQuery } from '#lib/server/browse/parse-query.js';
import type { BrowseQuery } from '#lib/server/browse/types.js';
import { BASIC_ID } from '#lib/server/domain/builtin.js';
import { createNote } from '#lib/server/domain/notes.js';
import { countRows } from '#lib/server/domain/store/suite-support.js';
import {
  addDeck,
  createPgStudyHarness,
  type StudyHarness,
} from '#lib/server/study/test-support/harness.js';

const url = process.env.SREP_TEST_POSTGRES_URL;
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
}

async function fronts(q: string): Promise<string[]> {
  const parsed = parseBrowseQuery(q);
  if (!parsed.ok) throw new Error(q);
  return frontsOf(parsed.query);
}

async function frontsOf(query: BrowseQuery): Promise<string[]> {
  if (h === undefined || h.handle.dialect !== 'postgres') throw new Error('postgres');
  const page = await searchCards(h.handle.db, query, END, 50, null);
  return page.rows.map((row) => row.frontText).sort();
}

describe.skipIf(url === undefined)('postgres browse search live', () => {
  it('escapes LIKE marks, folds only A to Z, and keeps the note table', async () => {
    if (url === undefined) return;
    h = await createPgStudyHarness(url);
    const spanish = await addDeck(h, 'Spanish');
    const verbs = await addDeck(h, 'Verbs', { parentId: spanish.id });
    const wild = await addDeck(h, '%_\\');
    await note(spanish.id, ['a\\b', 'x'], ['animals']);
    await note(spanish.id, ['ab', 'x']);
    await note(spanish.id, ['100%_x', 'y']);
    await note(spanish.id, ['100A_x', 'y']);
    await note(spanish.id, ['Äpfel', 'z']);
    await note(spanish.id, ['äpfel', 'z']);
    await note(spanish.id, ['GATO', 'cat']);
    await note(verbs.id, ['child', 'x']);
    await note(wild.id, ['wild', 'x']);
    const before = await countRows(h, 'note');
    const hostile = `'; drop table note; --`;
    expect(await frontsOf({ decks: [], tags: [hostile], is: [], props: [], texts: [] })).toEqual(
      [],
    );
    expect(await countRows(h, 'note')).toBe(before);
    expect(await fronts('a\\b')).toEqual(['a\\b']);
    expect(await fronts('\\')).toEqual(['a\\b']);
    expect(await fronts('ab')).toEqual(['ab']);
    expect(await fronts('%')).toEqual(['100%_x']);
    expect(await fronts('_')).toEqual(['100%_x', '100A_x']);
    expect(await fronts('GATO')).toEqual(['GATO']);
    expect(await fronts('gato')).toEqual(['GATO']);
    expect(await fronts('Ä')).toEqual(['Äpfel']);
    expect(await fronts('ä')).toEqual(['äpfel']);
    expect(await fronts('deck:Spanish')).toEqual([
      '100%_x',
      '100A_x',
      'GATO',
      'a\\b',
      'ab',
      'child',
      'Äpfel',
      'äpfel',
    ]);
    expect(await fronts('deck:%_\\')).toEqual(['wild']);
    expect(await fronts('deck:Spanish::Verbs')).toEqual(['child']);
  });
});
