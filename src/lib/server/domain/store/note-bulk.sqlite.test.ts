import { afterEach, describe, expect, it } from 'vitest';
import { BASIC_ID } from '#lib/server/domain/builtin.js';
import { createNote } from '#lib/server/domain/notes.js';
import { countRows } from '#lib/server/domain/store/suite-support.js';
import { replaceNoteTags, trashNotes } from '#lib/server/domain/store/note-bulk.sqlite.js';
import {
  addDeck,
  createStudyHarness,
  type StudyHarness,
} from '#lib/server/study/test-support/harness.js';

const missing = '123e4567-e89b-42d3-a456-426614174000';

let h: StudyHarness | undefined;

afterEach(async () => {
  await h?.close();
  h = undefined;
});

function db() {
  if (h === undefined || h.handle.dialect !== 'sqlite') throw new Error('sqlite harness');
  return h.handle.db;
}

async function makeNote(name: string, tags: string[]) {
  if (h === undefined) throw new Error('no harness');
  const deck = await addDeck(h, name);
  const result = await createNote(h.deps, {
    noteTypeId: BASIC_ID,
    deckId: deck.id,
    fields: ['gato', 'cat'],
    tags,
  });
  if (!result.ok) throw new Error(result.error);
  return result.note.id;
}

describe('sqlite note bulk', () => {
  it('adds and removes tags, and writes nothing when one id is missing', async () => {
    h = await createStudyHarness();
    const live = await makeNote('Live', ['animals']);
    const other = await makeNote('Other', ['plants']);
    expect(replaceNoteTags(db(), [live, missing], ['extra'], [], 50)).toBe('not_found');
    expect((await h.store.getNoteState(live))?.tags).toEqual(['animals']);
    expect(replaceNoteTags(db(), [live], ['extra'], ['animals'], 50)).toBe('ok');
    expect((await h.store.getNoteState(live))?.tags).toEqual(['extra']);
    expect((await h.store.getNoteState(live))?.note.updatedAt).toBe(50);
    expect(replaceNoteTags(db(), [other], [], ['plants'], 50)).toBe('ok');
    expect((await h.store.getNoteState(other))?.tags).toEqual([]);
    expect(replaceNoteTags(db(), [live], ['bad tag'], [], 60)).toBe('bad_request');
    expect((await h.store.getNoteState(live))?.note.updatedAt).toBe(50);
  });

  it('trashes every id or none', async () => {
    h = await createStudyHarness();
    const live = await makeNote('Live', ['animals']);
    const other = await makeNote('Other', ['plants']);
    expect(trashNotes(db(), [live, missing], 70)).toBe('not_found');
    expect((await h.store.getNoteState(live))?.note.deletedAt).toBeNull();
    expect(trashNotes(db(), [other], 70)).toBe('ok');
    expect((await h.store.getNoteState(other))?.note.deletedAt).toBe(70);
    expect(trashNotes(db(), [other, live], 80)).toBe('not_found');
    expect((await h.store.getNoteState(live))?.note.deletedAt).toBeNull();
  });

  it('rejects 0 ids, 101 ids, and a hostile id before SQL', async () => {
    h = await createStudyHarness();
    const live = await makeNote('Live', ['animals']);
    const before = await countRows(h, 'note');
    const ids = Array.from({ length: 101 }, () => live);
    expect(replaceNoteTags(db(), [], [], [], 1)).toBe('bad_request');
    expect(replaceNoteTags(db(), ids, [], [], 1)).toBe('bad_request');
    expect(trashNotes(db(), [], 1)).toBe('bad_request');
    expect(trashNotes(db(), ids, 1)).toBe('bad_request');
    expect(replaceNoteTags(db(), [`'; drop table note; --`], [], [], 1)).toBe('bad_request');
    expect(trashNotes(db(), [`'; drop table note; --`], 1)).toBe('bad_request');
    expect(await countRows(h, 'note')).toBe(before);
    expect((await h.store.getNoteState(live))?.note.deletedAt).toBeNull();
  });

  it('updates the note when the id is upper case', async () => {
    h = await createStudyHarness();
    const live = await makeNote('Live', ['animals']);
    expect(live).toBe(live.toLowerCase());
    expect(live.toUpperCase()).not.toBe(live);
    expect(replaceNoteTags(db(), [live.toUpperCase()], ['plants'], [], 9)).toBe('ok');
    expect((await h.store.getNoteState(live))?.tags).toEqual(['animals', 'plants']);
    expect(trashNotes(db(), [live.toUpperCase()], 11)).toBe('ok');
    expect((await h.store.getNoteState(live))?.note.deletedAt).toBe(11);
  });

  it('updates one note when the same id is repeated', async () => {
    h = await createStudyHarness();
    const live = await makeNote('Live', ['animals']);
    expect(replaceNoteTags(db(), [live, live], ['plants'], [], 9)).toBe('ok');
    expect((await h.store.getNoteState(live))?.tags).toEqual(['animals', 'plants']);
  });
});
