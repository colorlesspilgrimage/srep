import { describe, expect, it } from 'vitest';
import { parseDecks, parseEditorNote, parsePreview, parseTypes } from './note-editor-parse.js';

const ID = '123e4567-e89b-42d3-a456-426614174000';
const ID2 = '123e4567-e89b-42d3-a456-426614174001';

describe('note editor parse', () => {
  it('reads decks, types, preview cards, and a note', () => {
    expect(parseDecks({ decks: [{ id: ID, name: 'Alpha', extra: 1 }] })).toEqual([
      { id: ID, name: 'Alpha' },
    ]);
    expect(
      parseTypes({
        noteTypes: [{ id: ID, name: 'Basic', fields: ['Front', 'Back'], templates: [] }],
      }),
    ).toEqual([{ id: ID, name: 'Basic', fields: ['Front', 'Back'] }]);
    expect(
      parsePreview({
        cards: [{ templateName: 'Card 1', ordinal: 0, front: 'gato', back: 'cat' }],
      }),
    ).toEqual([{ templateName: 'Card 1', ordinal: 0, front: 'gato', back: 'cat' }]);
    expect(
      parseEditorNote({
        note: {
          id: ID,
          noteTypeId: ID2,
          fields: ['gato', 'cat'],
          tags: ['animals'],
          duplicates: [ID2],
          cards: [{ deckId: null }, { deckId: ID }],
        },
      }),
    ).toEqual({
      id: ID,
      noteTypeId: ID2,
      fields: ['gato', 'cat'],
      tags: ['animals'],
      deckId: ID,
      duplicates: [ID2],
    });
  });

  it('returns null for a bad shape and null when every card has no deck', () => {
    expect(parseDecks(null)).toBeNull();
    expect(parseDecks({ decks: [{ id: 'x', name: 'A' }] })).toBeNull();
    expect(parseDecks({ decks: [1] })).toBeNull();
    expect(parseDecks({})).toBeNull();
    expect(parseTypes({ noteTypes: [{ id: ID, name: 'Basic', fields: [] }] })).toBeNull();
    expect(parseTypes({ noteTypes: [{ id: ID, name: 'A\u0000', fields: ['F'] }] })).toBeNull();
    expect(parseTypes({ noteTypes: 'no' })).toBeNull();
    expect(
      parsePreview({ cards: [{ templateName: 'C', ordinal: -1, front: '', back: '' }] }),
    ).toBeNull();
    expect(
      parsePreview({ cards: [{ templateName: 'C', ordinal: 1.2, front: '', back: '' }] }),
    ).toBeNull();
    expect(parsePreview({ cards: 'no' })).toBeNull();
    expect(parsePreview({})).toBeNull();
    expect(parseEditorNote({ note: { id: ID } })).toBeNull();
    expect(parseEditorNote({})).toBeNull();
    expect(parseEditorNote(null)).toBeNull();
    expect(
      parseEditorNote({
        note: {
          id: ID,
          noteTypeId: ID,
          fields: ['a'],
          tags: ['ok'],
          duplicates: ['not-a-uuid'],
          cards: [],
        },
      }),
    ).toBeNull();
    expect(
      parseEditorNote({
        note: {
          id: ID,
          noteTypeId: ID,
          fields: ['a'],
          tags: ['ok'],
          duplicates: [],
          cards: [{ deckId: null }],
        },
      }),
    ).toMatchObject({ deckId: null });
    expect(
      parseEditorNote({
        note: {
          id: ID,
          noteTypeId: ID,
          fields: ['a'],
          tags: ['ok'],
          duplicates: [],
          cards: [{ deckId: 'bad' }],
        },
      }),
    ).toBeNull();
    expect(
      parseEditorNote({
        note: {
          id: ID,
          noteTypeId: ID,
          fields: ['a'],
          tags: ['ok'],
          duplicates: [],
          cards: [1],
        },
      }),
    ).toBeNull();
  });
});
