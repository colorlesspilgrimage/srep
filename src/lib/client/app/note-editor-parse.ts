// Contract: read note-editor JSON into fixed fields.
// Unknown shapes return null. The caller shows an error and does not render them.
// Only known keys are read. A deck id and a note id must be UUIDs.
// No I/O.

import { isDeckUuid } from './deck-id.js';

export type EditorDeck = { id: string; name: string };
export type EditorType = { id: string; name: string; fields: string[] };
export type PreviewCardView = {
  templateName: string;
  ordinal: number;
  front: string;
  back: string;
};
export type EditorNote = {
  id: string;
  noteTypeId: string;
  fields: string[];
  tags: string[];
  deckId: string | null;
  duplicates: string[];
};

const MAX_NAME = 200;
const MAX_FIELDS = 100;
const MAX_TEXT = 50_000;
const MAX_CARDS = 200;
const MAX_TAGS = 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readText(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || value.length > max || value.includes('\u0000')) {
    return null;
  }
  return value;
}

function readUuid(value: unknown): string | null {
  if (typeof value !== 'string' || !isDeckUuid(value)) {
    return null;
  }
  return value;
}

function readStringList(value: unknown, maxItems: number, maxText: number): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) {
    return null;
  }
  const out: string[] = [];
  for (const item of value) {
    const text = readText(item, maxText);
    if (text === null) {
      return null;
    }
    out.push(text);
  }
  return out;
}

export function parseDecks(body: unknown): EditorDeck[] | null {
  if (!isRecord(body) || !Array.isArray(body.decks)) {
    return null;
  }
  const decks: EditorDeck[] = [];
  for (const item of body.decks) {
    if (!isRecord(item)) {
      return null;
    }
    const id = readUuid(item.id);
    const name = readText(item.name, MAX_NAME);
    if (id === null || name === null) {
      return null;
    }
    decks.push({ id, name });
  }
  return decks;
}

export function parseTypes(body: unknown): EditorType[] | null {
  if (!isRecord(body) || !Array.isArray(body.noteTypes)) {
    return null;
  }
  const types: EditorType[] = [];
  for (const item of body.noteTypes) {
    if (!isRecord(item)) {
      return null;
    }
    const id = readUuid(item.id);
    const name = readText(item.name, MAX_NAME);
    const fields = readStringList(item.fields, MAX_FIELDS, MAX_NAME);
    if (id === null || name === null || fields === null || fields.length === 0) {
      return null;
    }
    types.push({ id, name, fields });
  }
  return types;
}

function readOrdinal(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 999) {
    return null;
  }
  return value;
}

export function parsePreview(body: unknown): PreviewCardView[] | null {
  if (!isRecord(body) || !Array.isArray(body.cards) || body.cards.length > MAX_CARDS) {
    return null;
  }
  const cards: PreviewCardView[] = [];
  for (const item of body.cards) {
    if (!isRecord(item)) {
      return null;
    }
    const templateName = readText(item.templateName, MAX_NAME);
    const ordinal = readOrdinal(item.ordinal);
    const front = readText(item.front, MAX_TEXT);
    const back = readText(item.back, MAX_TEXT);
    if (templateName === null || ordinal === null || front === null || back === null) {
      return null;
    }
    cards.push({ templateName, ordinal, front, back });
  }
  return cards;
}

function readDeckId(cards: unknown): string | null | 'bad' {
  if (!Array.isArray(cards)) {
    return 'bad';
  }
  for (const item of cards) {
    if (!isRecord(item) || !('deckId' in item)) {
      return 'bad';
    }
    if (item.deckId === null) {
      continue;
    }
    const id = readUuid(item.deckId);
    if (id === null) {
      return 'bad';
    }
    return id;
  }
  return null;
}

export function parseEditorNote(body: unknown): EditorNote | null {
  if (!isRecord(body) || !isRecord(body.note)) {
    return null;
  }
  const note = body.note;
  const id = readUuid(note.id);
  const noteTypeId = readUuid(note.noteTypeId);
  const fields = readStringList(note.fields, MAX_FIELDS, MAX_TEXT);
  const tags = readStringList(note.tags, MAX_TAGS, MAX_NAME);
  const duplicates = readStringList(note.duplicates, MAX_CARDS, 36);
  const deckId = readDeckId(note.cards);
  if (
    id === null ||
    noteTypeId === null ||
    fields === null ||
    tags === null ||
    duplicates === null ||
    deckId === 'bad'
  ) {
    return null;
  }
  if (!duplicates.every((item) => isDeckUuid(item))) {
    return null;
  }
  return { id, noteTypeId, fields, tags, deckId, duplicates };
}
