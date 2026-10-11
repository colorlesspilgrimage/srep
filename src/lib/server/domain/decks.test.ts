import { afterEach, describe, expect, it } from 'vitest';
import { BASIC_ID, DEFAULT_PRESET_ID } from '#lib/server/domain/builtin.js';
import {
  createDeck,
  deleteDeck,
  getDeck,
  getDeckImpact,
  listDecks,
  updateDeck,
} from '#lib/server/domain/decks.js';
import { createNote, getNote } from '#lib/server/domain/notes.js';
import { createPreset } from '#lib/server/domain/presets.js';
import {
  createDomainHarness,
  type DomainHarness,
} from '#lib/server/domain/test-support/harness.js';
import type { DeckRow } from '#lib/server/domain/store/store-types.js';
import { PRESET_INPUT } from '#lib/server/domain/test-support/fixtures.js';

let h: DomainHarness;
afterEach(async () => {
  await h.close();
});

const UNKNOWN = '123e4567-e89b-42d3-a456-426614174000';

async function make(name: string, parentId?: string, presetId?: string): Promise<DeckRow> {
  const result = await createDeck(h.deps, { name, parentId, presetId });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.deck;
}

async function preset(name: string): Promise<string> {
  const result = await createPreset(h.deps, { ...PRESET_INPUT, name });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.preset.id;
}

describe('createDeck', () => {
  it('creates a root and a child that inherits the preset', async () => {
    h = await createDomainHarness();
    const other = await preset('Other');
    const root = await make(' Languages ', undefined, other);
    expect(root).toMatchObject({ name: 'Languages', path: 'Languages', presetId: other });
    const child = await make('Japanese', root.id);
    expect(child).toMatchObject({
      path: 'Languages::Japanese',
      presetId: other,
      parentId: root.id,
    });
    const explicit = await make('Kanji', child.id, DEFAULT_PRESET_ID);
    expect(explicit.presetId).toBe(DEFAULT_PRESET_ID);
    expect((await make('Solo')).presetId).toBe(DEFAULT_PRESET_ID);
    const list = await listDecks(h.deps);
    expect(list.ok && list.decks.map((d) => d.path)).toEqual([
      'Languages',
      'Languages::Japanese',
      'Languages::Japanese::Kanji',
      'Solo',
    ]);
  });

  it('gives 404 for an unknown parent or preset, 409 for a duplicate, 400 for a bad name', async () => {
    h = await createDomainHarness();
    const root = await make('A');
    expect(await createDeck(h.deps, { name: 'B', parentId: UNKNOWN })).toMatchObject({
      status: 404,
    });
    expect(await createDeck(h.deps, { name: 'B', presetId: UNKNOWN })).toMatchObject({
      status: 404,
    });
    expect(await createDeck(h.deps, { name: 'A' })).toMatchObject({
      status: 409,
      error: 'deck_name_taken',
    });
    await make('B', root.id);
    expect(await createDeck(h.deps, { name: 'B', parentId: root.id })).toMatchObject({
      status: 409,
    });
    expect(await createDeck(h.deps, { name: 'x::y' })).toMatchObject({ status: 400 });
    expect(await getDeck(h.deps, UNKNOWN)).toMatchObject({ status: 404 });
    expect(await getDeck(h.deps, root.id)).toMatchObject({ ok: true, deck: root });
  });

  // Regression: `a:` + `b` and `a` + `:b` both gave the path `a:::b`. Then a delete of
  // deck `a` also deleted the child of deck `a:`.
  it('refuses names that start or end with a colon, so paths stay unique per tree', async () => {
    h = await createDomainHarness();
    const a = await make('a');
    const other = await make('a:b');
    const child = await make('c', other.id);
    expect(await createDeck(h.deps, { name: 'a:' })).toMatchObject({ status: 400 });
    expect(await createDeck(h.deps, { name: ':b', parentId: a.id })).toMatchObject({
      status: 400,
    });
    expect(await updateDeck(h.deps, child.id, { name: ':c' })).toMatchObject({ status: 400 });
    expect(await deleteDeck(h.deps, a.id, { action: 'trash' })).toEqual({ ok: true });
    const left = await listDecks(h.deps);
    expect(left.ok && left.decks.map((d) => d.path)).toEqual(['a:b', 'a:b::c']);
  });
});

describe('updateDeck', () => {
  it('renames and moves with all descendants', async () => {
    h = await createDomainHarness();
    const a = await make('A');
    const b = await make('B', a.id);
    await make('C', b.id);
    const x = await make('X');
    const renamed = await updateDeck(h.deps, a.id, { name: 'Lang' });
    expect(renamed.ok && renamed.decks.map((d) => d.path)).toEqual([
      'Lang',
      'Lang::B',
      'Lang::B::C',
    ]);
    const moved = await updateDeck(h.deps, b.id, { parentId: x.id });
    expect(moved.ok && moved.decks.map((d) => d.path)).toEqual(['X::B', 'X::B::C']);
  });

  it('refuses a cycle, a clash and an unknown preset', async () => {
    h = await createDomainHarness();
    const a = await make('A');
    const b = await make('B', a.id);
    await make('B');
    expect(await updateDeck(h.deps, a.id, { parentId: b.id })).toMatchObject({
      status: 409,
      error: 'deck_cycle',
    });
    expect(await updateDeck(h.deps, b.id, { parentId: null })).toMatchObject({
      status: 409,
      error: 'deck_name_taken',
    });
    expect(await updateDeck(h.deps, a.id, { presetId: UNKNOWN })).toMatchObject({ status: 404 });
    const other = await preset('Other');
    const changed = await updateDeck(h.deps, a.id, { presetId: other, description: 'd' });
    expect(changed.ok && changed.decks).toEqual([{ ...a, presetId: other, description: 'd' }]);
  });
});

describe('deleteDeck', () => {
  async function withNote() {
    const a = await make('A');
    const b = await make('B', a.id);
    const x = await make('X');
    const note = await createNote(h.deps, {
      noteTypeId: BASIC_ID,
      deckId: b.id,
      fields: ['dog', 'Hund'],
      tags: [],
    });
    if (!note.ok) {
      throw new Error(note.error);
    }
    return { a, b, x, noteId: note.note.id };
  }

  it('counts the impact and moves the cards', async () => {
    h = await createDomainHarness();
    const { a, b, x, noteId } = await withNote();
    expect(await getDeckImpact(h.deps, a.id)).toEqual({ ok: true, decks: 2, cards: 1, notes: 1 });
    expect(await getDeckImpact(h.deps, UNKNOWN)).toMatchObject({ status: 404 });
    expect(await deleteDeck(h.deps, a.id, { action: 'move', targetDeckId: b.id })).toMatchObject({
      status: 409,
    });
    expect(await deleteDeck(h.deps, a.id, { action: 'move', targetDeckId: UNKNOWN })).toMatchObject(
      {
        status: 404,
      },
    );
    expect(await deleteDeck(h.deps, a.id, { action: 'move', targetDeckId: x.id })).toEqual({
      ok: true,
    });
    const note = await getNote(h.deps, noteId);
    expect(note.ok && note.note.cards[0]?.deckId).toBe(x.id);
  });

  it('trashes the notes', async () => {
    h = await createDomainHarness();
    const { a, noteId } = await withNote();
    h.clock.now = 7_000;
    expect(await deleteDeck(h.deps, a.id, { action: 'trash' })).toEqual({ ok: true });
    const note = await getNote(h.deps, noteId);
    expect(note.ok && note.note.deletedAt).toBe(7_000);
    expect(await deleteDeck(h.deps, a.id, { action: 'trash' })).toMatchObject({ status: 404 });
  });
});
