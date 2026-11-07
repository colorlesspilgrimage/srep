import { afterEach, describe, expect, it } from 'vitest';
import { BASIC_ID, BUILTIN_PRESET } from '#lib/server/domain/builtin.js';
import { createDeck } from '#lib/server/domain/decks.js';
import { createNote, getNote, trashNote } from '#lib/server/domain/notes.js';
import { seedDomain } from '#lib/server/domain/seed.js';
import {
  createDomainHarness,
  type DomainHarness,
} from '#lib/server/domain/test-support/harness.js';

let h: DomainHarness;
afterEach(async () => {
  await h.close();
});

describe('seedDomain', () => {
  it('adds the built-in preset and note types once', async () => {
    h = await createDomainHarness();
    const before = await h.store.listNoteTypes();
    expect(
      before.map((t) => [t.name, t.fields, t.templates.map((x) => [x.frontTpl, x.backTpl])]),
    ).toEqual([
      ['Basic', ['Front', 'Back'], [['{{Front}}', '{{Front}}<hr>{{Back}}']]],
      [
        'Basic+Reversed',
        ['Front', 'Back'],
        [
          ['{{Front}}', '{{Front}}<hr>{{Back}}'],
          ['{{Back}}', '{{Back}}<hr>{{Front}}'],
        ],
      ],
      ['Cloze', ['Text', 'Extra'], [['{{cloze:Text}}', '{{cloze:Text}}<br>{{Extra}}']]],
    ]);
    await seedDomain(h.deps);
    expect(await h.store.listNoteTypes()).toEqual(before);
    expect(await h.store.listPresets()).toEqual([BUILTIN_PRESET]);
  });

  it('empties trash that is 30 days old', async () => {
    h = await createDomainHarness();
    const deck = await createDeck(h.deps, { name: 'D' });
    if (!deck.ok) {
      throw new Error(deck.error);
    }
    const note = await createNote(h.deps, {
      noteTypeId: BASIC_ID,
      deckId: deck.deck.id,
      fields: ['a', 'b'],
      tags: [],
    });
    if (!note.ok) {
      throw new Error(note.error);
    }
    await trashNote(h.deps, note.note.id);
    h.clock.now += 30 * 24 * 3600 * 1000;
    await seedDomain(h.deps);
    expect(await getNote(h.deps, note.note.id)).toMatchObject({ status: 404 });
  });
});
