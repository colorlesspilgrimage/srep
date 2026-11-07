import { afterEach, describe, expect, it } from 'vitest';
import { BASIC_ID, CLOZE_ID } from '#lib/server/domain/builtin.js';
import type { NoteTypeCreateInput } from '#lib/server/domain/core/validation.js';
import { createDeck } from '#lib/server/domain/decks.js';
import {
  createNoteType,
  deleteNoteType,
  getNoteType,
  listNoteTypes,
} from '#lib/server/domain/note-types.js';
import { createNote, trashNote } from '#lib/server/domain/notes.js';
import {
  createDomainHarness,
  type DomainHarness,
} from '#lib/server/domain/test-support/harness.js';

let h: DomainHarness;
afterEach(async () => {
  await h.close();
});

const vocab: NoteTypeCreateInput = {
  name: 'Vocab',
  fields: ['Word', 'Meaning', 'Audio'],
  templates: [
    { name: 'Read', front: '{{Word}}', back: '{{Meaning}}{{#Audio}}<br>{{Audio}}{{/Audio}}' },
    { name: 'Listen', front: '{{#Audio}}{{Audio}}{{/Audio}}', back: '{{Word}}' },
  ],
};

async function expectError(input: Partial<NoteTypeCreateInput>, status: number, error: string) {
  expect(await createNoteType(h.deps, { ...vocab, ...input })).toEqual({
    ok: false,
    status,
    error,
  });
}

describe('createNoteType', () => {
  it('creates a custom type with a conditional template', async () => {
    h = await createDomainHarness();
    const created = await createNoteType(h.deps, vocab);
    expect(created).toMatchObject({
      ok: true,
      noteType: { name: 'Vocab', cssClass: 'custom', sortFieldIdx: 0, fields: vocab.fields },
    });
    if (!created.ok) {
      return;
    }
    expect(created.noteType.templates.map((t) => [t.name, t.ordinal])).toEqual([
      ['Read', 0],
      ['Listen', 1],
    ]);
    expect(await getNoteType(h.deps, created.noteType.id)).toEqual(created);
    const list = await listNoteTypes(h.deps);
    expect(list.ok && list.noteTypes.map((t) => t.name)).toEqual([
      'Basic',
      'Basic+Reversed',
      'Cloze',
      'Vocab',
    ]);
  });

  it('refuses bad templates and fields, and stores nothing', async () => {
    h = await createDomainHarness();
    const bad = (front: string) => [{ name: 'T', front, back: '' }];
    await expectError({ templates: bad('{{Nope}}') }, 400, 'unknown_field');
    await expectError({ templates: bad('{{cloze:Nope}}') }, 400, 'unknown_field');
    await expectError({ templates: bad('{{#Word}}x') }, 400, 'invalid_template');
    await expectError({ fields: ['A', 'A'] }, 400, 'bad_request');
    await expectError({ fields: [] }, 400, 'bad_request');
    await expectError(
      { fields: Array.from({ length: 51 }, (_, i) => `f${i}`) },
      400,
      'bad_request',
    );
    await expectError({ fields: ['a:b', 'Word'] }, 400, 'bad_request');
    await expectError(
      {
        templates: Array.from({ length: 21 }, (_, i) => ({
          name: `t${i}`,
          front: '{{Word}}',
          back: '',
        })),
      },
      400,
      'bad_request',
    );
    await expectError({ templates: [] }, 400, 'bad_request');
    await expectError(
      { templates: [vocab.templates[0]!, { ...vocab.templates[0]!, name: ' Read ' }] },
      400,
      'bad_request',
    );
    await expectError({ sortFieldIdx: 3 }, 400, 'bad_request');
    await expectError({ cssClass: 'Bad Class' }, 400, 'bad_request');
    const list = await listNoteTypes(h.deps);
    expect(list.ok && list.noteTypes).toHaveLength(3);
  });

  it('accepts 50 fields and 20 templates', async () => {
    h = await createDomainHarness();
    const fields = Array.from({ length: 50 }, (_, i) => `f${i}`);
    const templates = Array.from({ length: 20 }, (_, i) => ({
      name: `t${i}`,
      front: `{{f${i}}}`,
      back: '',
    }));
    expect(await createNoteType(h.deps, { name: 'Big', fields, templates })).toMatchObject({
      ok: true,
    });
    await expectError({ name: 'Big' }, 409, 'name_taken');
  });
});

describe('deleteNoteType', () => {
  it('protects built-in types and types in use', async () => {
    h = await createDomainHarness();
    expect(await deleteNoteType(h.deps, BASIC_ID)).toMatchObject({ error: 'builtin_protected' });
    expect(await deleteNoteType(h.deps, CLOZE_ID)).toMatchObject({ status: 409 });
    const created = await createNoteType(h.deps, vocab);
    const deck = await createDeck(h.deps, { name: 'D' });
    if (!created.ok || !deck.ok) {
      throw new Error('setup failed');
    }
    const note = await createNote(h.deps, {
      noteTypeId: created.noteType.id,
      deckId: deck.deck.id,
      fields: ['w', 'm', ''],
      tags: [],
    });
    if (!note.ok) {
      throw new Error(note.error);
    }
    await trashNote(h.deps, note.note.id);
    expect(await deleteNoteType(h.deps, created.noteType.id)).toMatchObject({ error: 'in_use' });
  });

  it('deletes an unused type and gives 404 after', async () => {
    h = await createDomainHarness();
    const created = await createNoteType(h.deps, vocab);
    if (!created.ok) {
      throw new Error(created.error);
    }
    expect(await deleteNoteType(h.deps, created.noteType.id)).toEqual({ ok: true });
    expect(await deleteNoteType(h.deps, created.noteType.id)).toMatchObject({ status: 404 });
    expect(await getNoteType(h.deps, created.noteType.id)).toMatchObject({ status: 404 });
  });
});
