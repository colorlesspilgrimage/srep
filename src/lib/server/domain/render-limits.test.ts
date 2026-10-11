import { afterEach, describe, expect, it } from 'vitest';
import { createDeck } from '#lib/server/domain/decks.js';
import { createNoteType } from '#lib/server/domain/note-types.js';
import { createNote, getNote, updateNote } from '#lib/server/domain/notes.js';
import {
  createDomainHarness,
  type DomainHarness,
} from '#lib/server/domain/test-support/harness.js';

// Security tests for the note services: render cost (CWE-400, CWE-405) and
// field names that are also Object.prototype keys (CWE-1321).

let h: DomainHarness;
afterEach(async () => {
  await h.close();
});

async function setup(): Promise<string> {
  h = await createDomainHarness();
  const deck = await createDeck(h.deps, { name: 'Main' });
  if (!deck.ok) {
    throw new Error(deck.error);
  }
  return deck.deck.id;
}

async function noteType(fields: string[], front: string, back: string): Promise<string> {
  const result = await createNoteType(h.deps, {
    name: 'Custom',
    fields,
    templates: [{ name: 'Card', front, back }],
  });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.noteType.id;
}

// 100 distinct cloze indices in one field: about 1 KB.
const manyClozes = Array.from({ length: 100 }, (_, i) => `{{c${i + 1}::a}}`).join('');

describe('CWE-400 render amplification', () => {
  it('refuses a note whose cards cost too much to render (413)', async () => {
    const deckId = await setup();
    const refs = '{{cloze:T}}'.repeat(500);
    const id = await noteType(['T'], refs, refs);
    const result = await createNote(h.deps, {
      noteTypeId: id,
      deckId,
      fields: [manyClozes],
      tags: [],
    });
    expect(result).toEqual({ ok: false, status: 413, error: 'payload_too_large' });
  });

  it('refuses an update that makes the note too costly (413) and keeps the old note', async () => {
    const deckId = await setup();
    const refs = '{{cloze:T}}'.repeat(500);
    const id = await noteType(['T'], refs, refs);
    const created = await createNote(h.deps, {
      noteTypeId: id,
      deckId,
      fields: ['{{c1::a}}'],
      tags: [],
    });
    if (!created.ok) {
      throw new Error(created.error);
    }
    const result = await updateNote(h.deps, created.note.id, { fields: [manyClozes] });
    expect(result).toEqual({ ok: false, status: 413, error: 'payload_too_large' });
    const after = await getNote(h.deps, created.note.id);
    expect(after.ok && after.note.cards).toHaveLength(1);
  });

  it('accepts a large normal cloze note', async () => {
    const deckId = await setup();
    const id = await noteType(['T'], '{{cloze:T}}', '{{cloze:T}}');
    const result = await createNote(h.deps, {
      noteTypeId: id,
      deckId,
      fields: [manyClozes],
      tags: [],
    });
    expect(result.ok && result.note.cards).toHaveLength(100);
  });
});

describe('CWE-1321 field named like an Object.prototype key', () => {
  it('renders a field named __proto__ as its own value', async () => {
    const deckId = await setup();
    const id = await noteType(
      ['__proto__', 'constructor'],
      '{{#__proto__}}{{__proto__}}{{/__proto__}}',
      '{{constructor}}|{{cloze:__proto__}}',
    );
    const result = await createNote(h.deps, {
      noteTypeId: id,
      deckId,
      fields: ['front <b>x</b>', ''],
      tags: [],
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.note.cards[0]).toMatchObject({
      front: 'front <b>x</b>',
      back: '|front <b>x</b>',
    });
  });

  it('gives no card when a field named __proto__ is empty', async () => {
    const deckId = await setup();
    const id = await noteType(['__proto__'], '{{__proto__}}', 'b');
    const result = await createNote(h.deps, { noteTypeId: id, deckId, fields: [''], tags: [] });
    expect(result.ok && result.note.cards).toEqual([]);
  });
});
