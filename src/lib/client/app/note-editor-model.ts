// Contract: pure values for the note editor.
// Tags split on white space. An empty part is dropped.
// A preview response is current only when its serial matches.
// A media token is built only from 64 lower-case hex digits.
// The duplicate sentence does not block a save. The caller shows it after save.
// No I/O.

export type NoteEditorProps = {
  mode: 'new' | 'edit';
  noteId: string | null;
  initialDeckId: string | null;
};

export const DUPLICATE_NOTE_TEXT = 'A note with this first field already exists.';
export const PREVIEW_FAILED_TEXT = 'The preview failed.';
export const PREVIEW_DELAY_MS = 200;

export type PreviewDecision<T> =
  { type: 'ignore' } | { type: 'error' } | { type: 'cards'; cards: readonly T[] };

export function previewDecision<T>(input: {
  alive: boolean;
  mine: number;
  serial: number;
  ok: boolean;
  cards: readonly T[] | null;
}): PreviewDecision<T> {
  if (!input.alive || !previewIsCurrent(input.mine, input.serial)) {
    return { type: 'ignore' };
  }
  if (!input.ok || input.cards === null) {
    return { type: 'error' };
  }
  return { type: 'cards', cards: input.cards };
}

export function splitTags(text: string): string[] {
  const tags: string[] = [];
  for (const part of text.split(/\s+/)) {
    if (part.length > 0) {
      tags.push(part);
    }
  }
  return tags;
}

export function joinTags(tags: readonly string[]): string {
  return tags.join(' ');
}

export function nextSerial(current: number): number {
  return current + 1;
}

export function previewIsCurrent(sent: number, current: number): boolean {
  return sent === current;
}

function bound(value: number, length: number): number {
  if (!Number.isInteger(value) || value < 0) {
    return 0;
  }
  if (value > length) {
    return length;
  }
  return value;
}

export function insertSlice(text: string, start: number, end: number, chunk: string): string {
  const left = Math.min(bound(start, text.length), bound(end, text.length));
  const right = Math.max(bound(start, text.length), bound(end, text.length));
  return text.slice(0, left) + chunk + text.slice(right);
}

const SHA = /^[0-9a-f]{64}$/;

export function mediaToken(sha: string): string | null {
  if (!SHA.test(sha)) {
    return null;
  }
  return `{{media:${sha}}}`;
}

export function duplicateText(duplicates: readonly string[]): string {
  if (duplicates.length === 0) {
    return '';
  }
  return DUPLICATE_NOTE_TEXT;
}

export function fieldsForCount(current: readonly string[], count: number): string[] {
  if (!Number.isInteger(count) || count < 0) {
    return [];
  }
  const next: string[] = [];
  for (let index = 0; index < count; index += 1) {
    next.push(current[index] ?? '');
  }
  return next;
}

export function pickBasicTypeId(types: readonly { id: string; name: string }[]): string | null {
  for (const row of types) {
    if (row.name === 'Basic') {
      return row.id;
    }
  }
  const first = types[0];
  if (first === undefined) {
    return null;
  }
  return first.id;
}

export function pickDeckIndex(decks: readonly { id: string }[], deckId: string | null): number {
  if (deckId === null) {
    return 0;
  }
  const index = decks.findIndex((row) => row.id === deckId);
  if (index < 0) {
    return 0;
  }
  return index;
}
