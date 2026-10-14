import { afterEach, describe, expect, it } from 'vitest';
import { BASIC_ID } from '#lib/server/domain/builtin.js';
import { createDeck } from '#lib/server/domain/decks.js';
import { createNote, getNote } from '#lib/server/domain/notes.js';
import {
  createDomainHarness,
  type DomainHarness,
} from '#lib/server/domain/test-support/harness.js';

// Contract: getNote reads the note state once and keeps the view JSON.

let h: DomainHarness | undefined;

afterEach(async () => {
  await h?.close();
  h = undefined;
});

describe('getNote', () => {
  it('reads the note once and returns tags, cards, and duplicates', async () => {
    h = await createDomainHarness();
    const deck = await createDeck(h.deps, { name: 'Main' });
    if (!deck.ok) {
      throw new Error(deck.error);
    }
    const first = await createNote(h.deps, {
      noteTypeId: BASIC_ID,
      deckId: deck.deck.id,
      fields: ['front', 'back'],
      tags: ['tag'],
    });
    const second = await createNote(h.deps, {
      noteTypeId: BASIC_ID,
      deckId: deck.deck.id,
      fields: ['front', 'back'],
      tags: ['tag'],
    });
    if (!first.ok || !second.ok) {
      throw new Error('create failed');
    }
    const original = h.store.getNoteState.bind(h.store);
    let calls = 0;
    h.store.getNoteState = async (id: string) => {
      calls += 1;
      return original(id);
    };
    const view = await getNote(h.deps, first.note.id);
    expect(calls).toBe(1);
    expect(view.ok).toBe(true);
    if (!view.ok) {
      return;
    }
    expect(view.note.tags).toEqual(['tag']);
    expect(view.note.cards).toHaveLength(1);
    expect(view.note.fields).toEqual(['front', 'back']);
    expect(view.note.duplicates).toEqual([second.note.id]);
    expect(await getNote(h.deps, 'missing')).toMatchObject({ status: 404, error: 'not_found' });
  });
});
