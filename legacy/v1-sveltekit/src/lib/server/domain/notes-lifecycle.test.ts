import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { BASIC_ID, BASIC_REVERSED_ID } from '#lib/server/domain/builtin.js';
import { createDeck, deleteDeck } from '#lib/server/domain/decks.js';
import {
  createNote,
  getNote,
  moveCards,
  purgeTrash,
  restoreNote,
  trashNote,
  TRASH_RETENTION_MS,
  updateNote,
  type NoteView,
} from '#lib/server/domain/notes.js';
import { execSql } from '#lib/server/domain/store/suite-support.js';
import {
  createDomainHarness,
  type DomainHarness,
} from '#lib/server/domain/test-support/harness.js';

let h: DomainHarness;
afterEach(async () => {
  await h.close();
});

const DAY = 24 * 3600 * 1000;

async function deck(name: string): Promise<string> {
  const result = await createDeck(h.deps, { name });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.deck.id;
}

async function note(deckId: string, front = 'dog'): Promise<NoteView> {
  const result = await createNote(h.deps, {
    noteTypeId: BASIC_REVERSED_ID,
    deckId,
    fields: [front, 'Hund'],
    tags: [],
  });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.note;
}

describe('trash and restore', () => {
  it('trashes a note and restores it', async () => {
    h = await createDomainHarness();
    const n = await note(await deck('A'));
    h.clock.now = 2_000_000;
    expect(await trashNote(h.deps, n.id)).toEqual({ ok: true });
    expect(await trashNote(h.deps, n.id)).toMatchObject({ status: 404 });
    const trashed = await getNote(h.deps, n.id);
    expect(trashed.ok && trashed.note.deletedAt).toBe(2_000_000);
    expect(await updateNote(h.deps, n.id, { tags: ['x'] })).toMatchObject({ status: 404 });
    const restored = await restoreNote(h.deps, n.id, {});
    expect(restored.ok && restored.note.deletedAt).toBeNull();
    expect(await restoreNote(h.deps, n.id, {})).toMatchObject({ status: 404 });
  });

  it('asks for a deck when the old deck is gone', async () => {
    h = await createDomainHarness();
    const gone = await deck('Gone');
    const other = await deck('Other');
    const n = await note(gone);
    await deleteDeck(h.deps, gone, { action: 'trash' });
    expect(await restoreNote(h.deps, n.id, {})).toMatchObject({
      status: 400,
      error: 'deck_required',
    });
    expect(await restoreNote(h.deps, n.id, { deckId: n.id })).toMatchObject({ status: 404 });
    const restored = await restoreNote(h.deps, n.id, { deckId: other });
    expect(restored.ok && restored.note.cards.map((c) => c.deckId)).toEqual([other, other]);
  });

  it('purges trash after 30 days at the earliest', async () => {
    h = await createDomainHarness();
    const d = await deck('A');
    const old = await note(d, 'old');
    const young = await note(d, 'young');
    h.clock.now = 10 * DAY;
    await trashNote(h.deps, old.id);
    h.clock.now = 12 * DAY;
    await trashNote(h.deps, young.id);
    h.clock.now = 10 * DAY + 29 * DAY;
    expect(await purgeTrash(h.deps)).toEqual({ ok: true, purged: 0 });
    h.clock.now = 10 * DAY + TRASH_RETENTION_MS;
    expect(await purgeTrash(h.deps)).toEqual({ ok: true, purged: 1 });
    h.clock.now = 10 * DAY + 31 * DAY;
    expect(await getNote(h.deps, old.id)).toMatchObject({ status: 404 });
    expect(await getNote(h.deps, young.id)).toMatchObject({ ok: true });
  });
});

describe('moveCards', () => {
  it('moves cards and keeps reps, lapses and due', async () => {
    h = await createDomainHarness();
    const from = await deck('From');
    const to = await deck('To');
    const n = await note(from);
    const ids = n.cards.map((c) => c.id);
    await execSql(h, sql`update card set reps = 3, lapses = 1, due = 42 where note_id = ${n.id}`);
    expect(await moveCards(h.deps, { cardIds: ids, deckId: to })).toEqual({ ok: true });
    const state = await h.store.getNoteState(n.id);
    for (const card of state?.cards ?? []) {
      expect(card).toMatchObject({ deckId: to, reps: 3, lapses: 1, due: 42 });
    }
  });

  it('moves nothing when one id is unknown', async () => {
    h = await createDomainHarness();
    const from = await deck('From');
    const to = await deck('To');
    const n = await note(from);
    const unknown = '123e4567-e89b-42d3-a456-426614174000';
    const ids = [n.cards[0]?.id ?? '', unknown];
    expect(await moveCards(h.deps, { cardIds: ids, deckId: to })).toMatchObject({ status: 404 });
    expect(await moveCards(h.deps, { cardIds: [ids[0] ?? ''], deckId: unknown })).toMatchObject({
      status: 404,
    });
    const state = await h.store.getNoteState(n.id);
    expect(state?.cards.map((c) => c.deckId)).toEqual([from, from]);
  });

  it('gives increasing positions to new cards', async () => {
    h = await createDomainHarness();
    const d = await deck('A');
    const first = await note(d, 'one');
    const second = await createNote(h.deps, {
      noteTypeId: BASIC_ID,
      deckId: d,
      fields: ['two', ''],
      tags: [],
    });
    const positions = [...first.cards, ...(second.ok ? second.note.cards : [])].map(
      (c) => c.position,
    );
    expect(positions).toEqual([0, 1, 2]);
  });
});
