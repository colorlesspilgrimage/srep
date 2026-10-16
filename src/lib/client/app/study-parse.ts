// Contract: read study and note JSON into fixed fields.
// Unknown shapes return null. The caller shows an error and does not render them.
// Only known keys are read. A card id or a note id must be a UUID.
// No I/O.

import { isDeckUuid } from './deck-id.js';
import type { StudyRating } from './study-keys.js';

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

function readCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return null;
  }
  return value;
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
  const minutes = value.intervalMinutes;
  if (typeof minutes !== 'number' || !Number.isInteger(minutes)) {
    return null;
  }
  return minutes;
}

function readPreviews(value: unknown): Record<StudyRating, number> | null {
  if (!isRecord(value)) {
    return null;
  }
  const one = readMinutes(value['1']);
  const two = readMinutes(value['2']);
  const three = readMinutes(value['3']);
  const four = readMinutes(value['4']);
  if (one === null || two === null || three === null || four === null) {
    return null;
  }
  return { 1: one, 2: two, 3: three, 4: four };
}

function readCard(value: unknown): ParsedCard | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readUuid(value.id);
  const noteId = readUuid(value.noteId);
  const front = readString(value.front);
  const back = readString(value.back);
  const previews = readPreviews(value.previews);
  const reps = value.reps;
  if (id === null || noteId === null || front === null || back === null || previews === null) {
    return null;
  }
  if (typeof reps !== 'number' || !Number.isInteger(reps) || reps < 0) {
    return null;
  }
  return { id, noteId, reps, front, back, previews };
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

function readFields(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_FIELDS) {
    return null;
  }
  const fields: string[] = [];
  for (const item of value) {
    const text = readString(item);
    if (text === null || text.length > MAX_FIELD_TEXT) {
      return null;
    }
    fields.push(text);
  }
  return fields;
}

function readNoteCard(value: unknown): NoteCardText | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readUuid(value.id);
  const front = readString(value.front);
  const back = readString(value.back);
  if (id === null || front === null || back === null) {
    return null;
  }
  return { id, front, back };
}

function readNoteCards(value: unknown): NoteCardText[] | null {
  if (!Array.isArray(value) || value.length > MAX_FIELDS) {
    return null;
  }
  const cards: NoteCardText[] = [];
  for (const item of value) {
    const card = readNoteCard(item);
    if (card === null) {
      return null;
    }
    cards.push(card);
  }
  return cards;
}

export function parseNoteBody(body: unknown): NoteBody | null {
  if (!isRecord(body) || !isRecord(body.note)) {
    return null;
  }
  const fields = readFields(body.note.fields);
  const cards = readNoteCards(body.note.cards);
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
  const minutes = body.review.intervalMinutes;
  if (typeof minutes !== 'number' || !Number.isInteger(minutes)) {
    return null;
  }
  return minutes;
}
