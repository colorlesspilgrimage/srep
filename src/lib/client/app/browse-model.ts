// Contract: pure browse-screen values. No I/O.
// A search path is built with URLSearchParams. The raw query is not concatenated.
// A cursor is set only after the UUID check. A bad cursor returns null.
// A note id enters a path only after the UUID check, then encodeURIComponent.
// Row text is plain text. A bad row is dropped. A bad page is null.
// A late search serial is ignored. The newest serial wins.
// Move and Suspend stop above 500 cards. Tag and Delete stop above 100 notes.
// not_found uses the bulk sentence. Other codes use a short sentence.

import { encodedUuid, isDeckUuid } from './deck-id.js';
import type { BrowseMove } from './browse-keys.js';

export const MAX_MOVE_CARDS = 500;
export const MAX_TAG_NOTES = 100;
export const MAX_QUERY_CHARS = 500;
export const MAX_ROWS = 100;
export const MAX_CELL = 500;
const MAX_TAGS_ON_ROW = 100;

export const BAD_QUERY_TEXT = 'The search is not valid.';
export const EMPTY_TEXT = 'No cards.';
export const NOT_FOUND_TEXT = 'One selected card was not found. Nothing was changed.';
export const CARD_CAP_TEXT = 'Move and Suspend allow at most 500 cards.';
export const NOTE_CAP_TEXT = 'Tag and Delete allow at most 100 notes.';

// Own keys only. A code such as "constructor" must not read Object members (CWE-1321).
const WRITE_TEXT = new Map<string, string>([
  ['not_found', NOT_FOUND_TEXT],
  ['bad_request', 'The request is not valid.'],
  ['network_error', 'The server did not answer.'],
  ['unauthenticated', 'Sign in and try again.'],
]);

const BAD_TAG = /[\s\p{Cc}]/u;

export type BrowseView = {
  cardId: string;
  noteId: string;
  deckId: string;
  deckPath: string;
  state: string;
  lapses: number;
  frontText: string;
  tags: string;
};

export type BrowseDeck = { id: string; name: string };

export type SearchEffect =
  | { type: 'ignore' }
  | { type: 'bad-query' }
  | { type: 'error'; message: string }
  | { type: 'rows'; rows: readonly BrowseView[] };

export type TagWrite = { noteIds: string[]; add: string[]; remove: string[] };

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function textCell(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || value.includes('\u0000')) {
    return null;
  }
  if (value.length > max) {
    return value.slice(0, max);
  }
  return value;
}

function uuidCell(value: unknown): string | null {
  if (typeof value !== 'string' || !isDeckUuid(value)) {
    return null;
  }
  return value;
}

function lapseCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return null;
  }
  if (value < 0 || value > 1_000_000) {
    return null;
  }
  return value;
}

function tagText(value: unknown): string | null {
  if (!Array.isArray(value) || value.length > MAX_TAGS_ON_ROW) {
    return null;
  }
  const tags: string[] = [];
  for (const item of value) {
    const text = textCell(item, 200);
    if (text === null) {
      return null;
    }
    if (text.length > 0) {
      tags.push(text);
    }
  }
  return tags.join(' ');
}

export function browseSearchPath(q: string, cursor: string | null = null): string | null {
  if (q.length > MAX_QUERY_CHARS || q.includes('\u0000')) {
    return null;
  }
  if (cursor !== null && !isDeckUuid(cursor)) {
    return null;
  }
  const params = new URLSearchParams();
  params.set('q', q);
  if (cursor !== null) {
    params.set('cursor', cursor);
  }
  return `/api/browse?${params.toString()}`;
}

export function browseNotePath(noteId: string): string | null {
  const id = encodedUuid(noteId);
  if (id === null) {
    return null;
  }
  return `/notes/${id}`;
}

function parseBrowseRow(value: unknown): BrowseView | null {
  const row = record(value);
  if (row === null) {
    return null;
  }
  const cardId = uuidCell(row.cardId);
  const noteId = uuidCell(row.noteId);
  const deckId = row.deckId === '' ? '' : uuidCell(row.deckId);
  const deckPath = textCell(row.deckPath, MAX_CELL);
  const state = textCell(row.state, 40);
  const frontText = textCell(row.frontText, MAX_CELL);
  const tags = tagText(row.tags);
  const lapses = lapseCount(row.lapses);
  if (cardId === null || noteId === null || deckId === null || deckPath === null) {
    return null;
  }
  if (state === null || frontText === null || tags === null || lapses === null) {
    return null;
  }
  return { cardId, noteId, deckId, deckPath, state, lapses, frontText, tags };
}

export function parseBrowsePage(body: unknown): BrowseView[] | null {
  const root = record(body);
  if (root === null || !Array.isArray(root.rows) || root.rows.length > MAX_ROWS) {
    return null;
  }
  const rows: BrowseView[] = [];
  for (const item of root.rows) {
    const row = parseBrowseRow(item);
    if (row === null || rows.some((kept) => kept.cardId === row.cardId)) {
      return null;
    }
    rows.push(row);
  }
  return rows;
}

function parseDeck(value: unknown): BrowseDeck | null {
  const row = record(value);
  if (row === null || (row.archivedAt !== null && row.archivedAt !== undefined)) {
    return null;
  }
  const id = uuidCell(row.id);
  const name = textCell(row.path, MAX_CELL);
  if (id === null || name === null || name.length === 0) {
    return null;
  }
  return { id, name };
}

export function parseDeckList(body: unknown): BrowseDeck[] | null {
  const root = record(body);
  if (root === null || !Array.isArray(root.decks)) {
    return null;
  }
  const decks: BrowseDeck[] = [];
  for (const item of root.decks) {
    const deck = parseDeck(item);
    if (deck !== null && !decks.some((kept) => kept.id === deck.id)) {
      decks.push(deck);
    }
  }
  decks.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return decks;
}

export function searchEffect(input: {
  alive: boolean;
  mine: number;
  serial: number;
  ok: boolean;
  error: string;
  rows: readonly BrowseView[] | null;
}): SearchEffect {
  if (!input.alive || input.mine !== input.serial) {
    return { type: 'ignore' };
  }
  if (!input.ok) {
    if (input.error === 'bad_query') {
      return { type: 'bad-query' };
    }
    return { type: 'error', message: writeMessage(input.error) };
  }
  if (input.rows === null) {
    return { type: 'error', message: writeMessage('error') };
  }
  return { type: 'rows', rows: input.rows };
}

export function writeMessage(error: string): string {
  return WRITE_TEXT.get(error) ?? 'The request failed.';
}

export function tagIsSendable(tag: string): boolean {
  const text = tag.trim();
  if (text.length < 1 || text.length > 200 || BAD_TAG.test(text)) {
    return false;
  }
  return true;
}

export function rowIndexAfter(length: number, index: number, move: BrowseMove): number {
  if (!Number.isInteger(length) || length < 1) {
    return 0;
  }
  const last = length - 1;
  const current = Number.isInteger(index) && index >= 0 && index <= last ? index : 0;
  if (move === 'first') {
    return 0;
  }
  if (move === 'last') {
    return last;
  }
  if (move === 'next') {
    return Math.min(last, current + 1);
  }
  return Math.max(0, current - 1);
}

export function indexOfCard(rows: readonly { cardId: string }[], cardId: string | null): number {
  if (cardId === null) {
    return 0;
  }
  const index = rows.findIndex((row) => row.cardId === cardId);
  return index < 0 ? 0 : index;
}

export function toggleCard(selected: readonly string[], cardId: string): string[] {
  if (!isDeckUuid(cardId)) {
    return [...selected];
  }
  if (selected.includes(cardId)) {
    return selected.filter((id) => id !== cardId);
  }
  return [...selected, cardId];
}

export function pageCardIds(rows: readonly { cardId: string }[]): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    if (isDeckUuid(row.cardId) && !ids.includes(row.cardId)) {
      ids.push(row.cardId);
    }
  }
  return ids;
}

function selectedIds(
  rows: readonly BrowseView[],
  selected: readonly string[],
  key: 'cardId' | 'noteId',
): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    if (!selected.includes(row.cardId) || !isDeckUuid(row[key])) {
      continue;
    }
    if (!ids.includes(row[key])) {
      ids.push(row[key]);
    }
  }
  return ids;
}

export function selectedCardIds(
  rows: readonly BrowseView[],
  selected: readonly string[],
): string[] {
  return selectedIds(rows, selected, 'cardId');
}

export function selectedNoteIds(
  rows: readonly BrowseView[],
  selected: readonly string[],
): string[] {
  return selectedIds(rows, selected, 'noteId');
}

export function keptSelection(
  rows: readonly { cardId: string }[],
  selected: readonly string[],
): string[] {
  const live = new Set(rows.map((row) => row.cardId));
  return selected.filter((id) => live.has(id));
}

export function moveAllowed(cardCount: number): boolean {
  return cardCount >= 1 && cardCount <= MAX_MOVE_CARDS;
}

export function noteWriteAllowed(noteCount: number): boolean {
  return noteCount >= 1 && noteCount <= MAX_TAG_NOTES;
}

export function cardCapText(count: number): string {
  return count > MAX_MOVE_CARDS ? CARD_CAP_TEXT : '';
}

export function noteCapText(count: number): string {
  return count > MAX_TAG_NOTES ? NOTE_CAP_TEXT : '';
}

function cleanIds(ids: readonly string[], max: number): string[] | null {
  if (ids.length < 1 || ids.length > max) {
    return null;
  }
  const clean: string[] = [];
  for (const id of ids) {
    if (!isDeckUuid(id) || clean.includes(id)) {
      return null;
    }
    clean.push(id);
  }
  return clean;
}

export function tagBody(
  noteIds: readonly string[],
  tag: string,
  mode: 'add' | 'remove',
): TagWrite | null {
  const text = tag.trim();
  if (!tagIsSendable(text)) {
    return null;
  }
  const ids = cleanIds(noteIds, MAX_TAG_NOTES);
  if (ids === null) {
    return null;
  }
  if (mode === 'add') {
    return { noteIds: ids, add: [text], remove: [] };
  }
  return { noteIds: ids, add: [], remove: [text] };
}

export function moveBody(
  cardIds: readonly string[],
  deckId: string,
): { cardIds: string[]; deckId: string } | null {
  if (!isDeckUuid(deckId)) {
    return null;
  }
  const ids = cleanIds(cardIds, MAX_MOVE_CARDS);
  if (ids === null) {
    return null;
  }
  return { cardIds: ids, deckId };
}

export function suspendBody(cardIds: readonly string[]): { cardIds: string[] } | null {
  const ids = cleanIds(cardIds, MAX_MOVE_CARDS);
  if (ids === null) {
    return null;
  }
  return { cardIds: ids };
}

export function trashBody(noteIds: readonly string[]): { noteIds: string[] } | null {
  const ids = cleanIds(noteIds, MAX_TAG_NOTES);
  if (ids === null) {
    return null;
  }
  return { noteIds: ids };
}
