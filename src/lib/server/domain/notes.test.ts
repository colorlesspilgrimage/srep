import { afterEach, describe, expect, it } from 'vitest';
import { BASIC_ID, BASIC_REVERSED_ID, CLOZE_ID } from '#lib/server/domain/builtin.js';
import { FLAG_ORPHANED } from '#lib/server/domain/core/card-plan.js';
import { createDeck } from '#lib/server/domain/decks.js';
import { storeMedia } from '#lib/server/domain/media.js';
import { createNoteType } from '#lib/server/domain/note-types.js';
import { createNote, getNote, updateNote, type NoteView } from '#lib/server/domain/notes.js';
import {
  createDomainHarness,
  type DomainHarness,
} from '#lib/server/domain/test-support/harness.js';
import { execSql } from '#lib/server/domain/store/suite-support.js';
import { sql } from 'drizzle-orm';
import { PNG } from '#lib/server/domain/test-support/fixtures.js';

let h: DomainHarness;
let deckId: string;
afterEach(async () => {
  await h.close();
});

async function setup(): Promise<void> {
  h = await createDomainHarness();
  const deck = await createDeck(h.deps, { name: 'Main' });
  if (!deck.ok) {
    throw new Error(deck.error);
  }
  deckId = deck.deck.id;
}

async function note(noteTypeId: string, fields: string[], tags: string[] = []): Promise<NoteView> {
  const result = await createNote(h.deps, { noteTypeId, deckId, fields, tags });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.note;
}

async function edit(id: string, patch: Parameters<typeof updateNote>[2]): Promise<NoteView> {
  const result = await updateNote(h.deps, id, patch);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.note;
}

describe('createNote', () => {
  it('gives 1 Basic card with rendered front and back', async () => {
    await setup();
    const n = await note(BASIC_ID, ['犬', 'dog'], ['Animals']);
    expect(n.cards).toHaveLength(1);
    expect(n.cards[0]).toMatchObject({
      front: '犬',
      back: '犬<hr>dog',
      templateName: 'Card 1',
      deckId,
    });
    expect(n.tags).toEqual(['animals']);
    expect(n.guid).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });

  it('gives 2 Basic+Reversed cards, or 1 with an empty Back', async () => {
    await setup();
    const full = await note(BASIC_REVERSED_ID, ['犬', 'dog']);
    expect(full.cards.map((c) => c.front)).toEqual(['犬', 'dog']);
    expect((await note(BASIC_REVERSED_ID, ['猫', ''])).cards).toHaveLength(1);
    expect((await note(BASIC_ID, ['', 'x'])).cards).toHaveLength(0);
  });

  it('gives one cloze card per index with the right text', async () => {
    await setup();
    const n = await note(CLOZE_ID, ['{{c1::a}} {{c2::b}} {{c1::c}}', 'extra']);
    expect(n.cards.map((c) => [c.ordinal, c.front, c.back])).toEqual([
      [
        1,
        '<span class="cloze">[...]</span> b <span class="cloze">[...]</span>',
        '<span class="cloze">a</span> b <span class="cloze">c</span><br>extra',
      ],
      [2, 'a <span class="cloze">[...]</span> c', 'a <span class="cloze">b</span> c<br>extra'],
    ]);
    expect(n.cards[1]!.position).toBeGreaterThan(n.cards[0]!.position);
  });

  it('uses a custom note type', async () => {
    await setup();
    const type = await createNoteType(h.deps, {
      name: 'Custom',
      fields: ['Q', 'Hint', 'Text'],
      templates: [
        { name: 'Q', front: '{{Q}}{{#Hint}} ({{Hint}}){{/Hint}}', back: '{{Q}}' },
        { name: 'C', front: '{{cloze:Text}}', back: '{{cloze:Text}}' },
      ],
    });
    if (!type.ok) {
      throw new Error(type.error);
    }
    const n = await note(type.noteType.id, ['q', 'h', '{{c2::x}}']);
    expect(n.cards.map((c) => [c.templateName, c.ordinal, c.front])).toEqual([
      ['Q', 0, 'q (h)'],
      ['C', 2, '<span class="cloze">[...]</span>'],
    ]);
  });

  it('checks field count, tags, media and the note type and deck', async () => {
    await setup();
    const input = { noteTypeId: BASIC_ID, deckId, fields: ['a', 'b'], tags: [] as string[] };
    const unknown = '123e4567-e89b-42d3-a456-426614174000';
    expect(await createNote(h.deps, { ...input, fields: ['a'] })).toMatchObject({
      error: 'field_count_mismatch',
    });
    expect(await createNote(h.deps, { ...input, tags: ['a b'] })).toMatchObject({
      error: 'invalid_tag',
    });
    expect(await createNote(h.deps, { ...input, noteTypeId: unknown })).toMatchObject({
      status: 404,
    });
    expect(await createNote(h.deps, { ...input, deckId: unknown })).toMatchObject({ status: 404 });
    expect(await createNote(h.deps, { ...input, fields: ['x'.repeat(50_001), ''] })).toMatchObject({
      status: 400,
    });
    const token = `{{media:${'a'.repeat(64)}}}`;
    expect(await createNote(h.deps, { ...input, fields: [token, ''] })).toMatchObject({
      status: 400,
      error: 'unknown_media',
    });
    const media = await storeMedia(h.deps, {
      bytes: PNG,
      declaredMime: 'image/png',
      originalName: 'x',
    });
    if (!media.ok) {
      throw new Error(media.error);
    }
    const ok = await createNote(h.deps, {
      ...input,
      fields: [`<img src="{{media:${media.media.sha256}}}">`, ''],
    });
    expect(ok).toMatchObject({ ok: true });
  });

  it('lists older notes with the same sort field as duplicates and still saves', async () => {
    await setup();
    const first = await note(BASIC_ID, ['<b>dog</b>', '1']);
    const second = await note(BASIC_ID, [' dog ', '2']);
    expect(first.duplicates).toEqual([]);
    expect(second.duplicates).toEqual([first.id]);
    const again = await getNote(h.deps, first.id);
    expect(again.ok && again.note.duplicates).toEqual([second.id]);
  });
});

describe('updateNote', () => {
  it('adds a card for a new cloze in the same deck, and deletes an unreviewed one', async () => {
    await setup();
    const n = await note(CLOZE_ID, ['{{c1::a}}', '']);
    const added = await edit(n.id, { fields: ['{{c1::a}} {{c2::b}}', ''] });
    expect(added.cards.map((c) => [c.ordinal, c.deckId])).toEqual([
      [1, deckId],
      [2, deckId],
    ]);
    expect(added.cards[0]!.id).toBe(n.cards[0]!.id);
    const removed = await edit(n.id, { fields: ['{{c2::b}}', ''], tags: ['New'] });
    expect(removed.cards.map((c) => c.ordinal)).toEqual([2]);
    expect(removed.tags).toEqual(['new']);
  });

  it('suspends a reviewed card with the orphan flag, and clears the flag when it returns', async () => {
    await setup();
    const n = await note(CLOZE_ID, ['{{c1::a}} {{c2::b}}', '']);
    const reviewed = n.cards[1]!.id;
    await execSql(h, sql`update card set reps = 1 where id = ${reviewed}`);
    const orphaned = await edit(n.id, { fields: ['{{c1::a}}', ''] });
    expect(orphaned.cards.find((c) => c.id === reviewed)).toMatchObject({
      state: 'suspended',
      flags: FLAG_ORPHANED,
    });
    const back = await edit(n.id, { fields: ['{{c1::a}} {{c2::b}}', ''] });
    expect(back.cards.find((c) => c.id === reviewed)).toMatchObject({
      state: 'suspended',
      flags: 0,
    });
    expect(back.cards).toHaveLength(2);
  });

  it('needs a deck when the note has no card left', async () => {
    await setup();
    const n = await note(BASIC_ID, ['', 'x']);
    expect(await updateNote(h.deps, n.id, { fields: ['now', 'x'] })).toMatchObject({
      status: 400,
      error: 'deck_required',
    });
    expect(await updateNote(h.deps, n.id, { fields: ['now', 'x'], deckId: n.id })).toMatchObject({
      status: 404,
    });
    const fixed = await edit(n.id, { fields: ['now', 'x'], deckId });
    expect(fixed.cards.map((c) => c.deckId)).toEqual([deckId]);
  });

  it('checks content on update and gives 404 for unknown notes', async () => {
    await setup();
    const n = await note(BASIC_ID, ['a', 'b']);
    expect(await updateNote(h.deps, n.id, { fields: ['a'] })).toMatchObject({
      error: 'field_count_mismatch',
    });
    expect(await updateNote(h.deps, n.id, { tags: ['\u0000'] })).toMatchObject({
      error: 'invalid_tag',
    });
    const unknown = '123e4567-e89b-42d3-a456-426614174000';
    expect(await updateNote(h.deps, unknown, {})).toMatchObject({ status: 404 });
    expect(await getNote(h.deps, unknown)).toMatchObject({ status: 404 });
  });

  // Regression (CWE-362): a tags-only patch read the fields before the transaction and
  // wrote them back. A parallel field edit between the read and the write was lost.
  it('keeps a parallel edit of the parts that the patch does not change', async () => {
    await setup();
    const n = await note(BASIC_ID, ['a', 'b'], ['old']);
    const racing = {
      ...h.deps,
      store: {
        ...h.store,
        updateNote: async (...args: Parameters<typeof h.store.updateNote>) => {
          await edit(n.id, { fields: ['changed', 'b'] });
          return h.store.updateNote(...args);
        },
      },
    };
    const result = await updateNote(racing, n.id, { tags: ['new'] });
    expect(result).toMatchObject({ ok: true, note: { fields: ['changed', 'b'], tags: ['new'] } });
    const fieldsOnly = {
      ...racing,
      store: {
        ...h.store,
        updateNote: async (...args: Parameters<typeof h.store.updateNote>) => {
          await edit(n.id, { tags: ['other'] });
          return h.store.updateNote(...args);
        },
      },
    };
    const second = await updateNote(fieldsOnly, n.id, { fields: ['x', 'y'] });
    expect(second).toMatchObject({ ok: true, note: { fields: ['x', 'y'], tags: ['other'] } });
    expect(second.ok && second.note.cards[0]?.front).toBe('x');
  });
});
