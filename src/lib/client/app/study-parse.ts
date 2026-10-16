// Contract: read study and note JSON into fixed fields.
// Unknown shapes return null. The caller shows an error and does not render them.
// Only known keys are read. A card id or a note id must be a UUID.
// No I/O.

import { isDeckUuid } from './deck-id.js';
import { STUDY_RATINGS, type StudyRating } from './study-keys.js';

export type StudyCounts = { new: number; learning: number; review: number };

export type ParsedCard = {
  id: string;
  noteId: string;
  reps: number;
  front: string;
  back: string;
  previews: Record<StudyRating, number>;
};

export type NextReply =
  | { status: 'card'; card: ParsedCard; counts: StudyCounts }
  | { status: 'wait'; until: number; counts: StudyCounts }
  | { status: 'done'; counts: StudyCounts };

export type NoteCardText = { id: string; front: string; back: string };

export type NoteBody = { fields: string[]; cards: NoteCardText[] };

const MAX_FIELDS = 100;
const MAX_FIELD_TEXT = 50_000;

export function validNoteFields(fields: readonly string[]): boolean {
  if (fields.length > MAX_FIELDS) {
    return false;
  }
  return fields.every((field) => field.length <= MAX_FIELD_TEXT && !field.includes('\u0000'));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string' || value.includes('\u0000')) {
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

function readInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return null;
  }
  return value;
}

function readCount(value: unknown): number | null {
  const count = readInteger(value);
  if (count === null || count < 0) {
    return null;
  }
  return count;
}

function readCounts(value: unknown): StudyCounts | null {
  if (!isRecord(value)) {
    return null;
  }
  const fresh = readCount(value.new);
  const learning = readCount(value.learning);
  const review = readCount(value.review);
  if (fresh === null || learning === null || review === null) {
    return null;
  }
  return { new: fresh, learning, review };
}

function readMinutes(value: unknown): number | null {
  if (!isRecord(value) || !('intervalMinutes' in value)) {
    return null;
  }
  return readInteger(value.intervalMinutes);
}

function readPreviews(value: unknown): Record<StudyRating, number> | null {
  if (!isRecord(value)) {
    return null;
  }
  const previews = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const rating of STUDY_RATINGS) {
    const minutes = readMinutes(value[String(rating)]);
    if (minutes === null) {
      return null;
    }
    previews[rating] = minutes;
  }
  return previews;
}

function readSides(value: Record<string, unknown>): { front: string; back: string } | null {
  const front = readString(value.front);
  const back = readString(value.back);
  if (front === null || back === null) {
    return null;
  }
  return { front, back };
}

function readCard(value: unknown): ParsedCard | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readUuid(value.id);
  const noteId = readUuid(value.noteId);
  const sides = readSides(value);
  const previews = readPreviews(value.previews);
  const reps = readInteger(value.reps);
  if (id === null || noteId === null || sides === null || previews === null || reps === null) {
    return null;
  }
  if (reps < 0) {
    return null;
  }
  return { id, noteId, reps, front: sides.front, back: sides.back, previews };
}

export function parseNextReply(body: unknown): NextReply | null {
  if (!isRecord(body)) {
    return null;
  }
  const counts = readCounts(body.counts);
  if (counts === null) {
    return null;
  }
  if (body.status === 'done') {
    return { status: 'done', counts };
  }
  if (body.status === 'wait') {
    if (typeof body.until !== 'number' || !Number.isFinite(body.until)) {
      return null;
    }
    return { status: 'wait', until: body.until, counts };
  }
  if (body.status !== 'card') {
    return null;
  }
  const card = readCard(body.card);
  if (card === null) {
    return null;
  }
  return { status: 'card', card, counts };
}

function readList<T>(value: unknown, readItem: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value) || value.length > MAX_FIELDS) {
    return null;
  }
  const items: T[] = [];
  for (const item of value) {
    const parsed = readItem(item);
    if (parsed === null) {
      return null;
    }
    items.push(parsed);
  }
  return items;
}

function readField(item: unknown): string | null {
  const text = readString(item);
  if (text === null || text.length > MAX_FIELD_TEXT) {
    return null;
  }
  return text;
}

function readNoteCard(value: unknown): NoteCardText | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readUuid(value.id);
  const sides = readSides(value);
  if (id === null || sides === null) {
    return null;
  }
  return { id, front: sides.front, back: sides.back };
}

export function parseNoteBody(body: unknown): NoteBody | null {
  if (!isRecord(body) || !isRecord(body.note)) {
    return null;
  }
  const fields = readList(body.note.fields, readField);
  const cards = readList(body.note.cards, readNoteCard);
  if (fields === null || cards === null) {
    return null;
  }
  return { fields, cards };
}

export function cardTextFromNote(
  note: NoteBody,
  cardId: string,
): { front: string; back: string } | null {
  const card = note.cards.find((item) => item.id === cardId);
  if (card === undefined) {
    return null;
  }
  return { front: card.front, back: card.back };
}

export function readAnswerInterval(body: unknown): number | null {
  if (!isRecord(body) || !isRecord(body.review)) {
    return null;
  }
  return readInteger(body.review.intervalMinutes);
}
