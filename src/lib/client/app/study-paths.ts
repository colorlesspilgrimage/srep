// Contract: study and note URLs.
// A deck id or a note id enters a URL only after the UUID check, then encodeURIComponent.
// A failed check returns null. The caller must not fetch.
// Card ids go in a JSON body, not in a path. No I/O.

import { isDeckUuid } from './deck-id.js';

export function studyNextPath(deckId: string | null): string | null {
  if (deckId === null) {
    return '/api/study/next';
  }
  if (!isDeckUuid(deckId)) {
    return null;
  }
  return `/api/study/next?deckId=${encodeURIComponent(deckId)}`;
}

export function studyDeckQuery(deckId: string): string | null {
  if (!isDeckUuid(deckId)) {
    return null;
  }
  return encodeURIComponent(deckId);
}

export function noteResourcePath(noteId: string): string | null {
  if (!isDeckUuid(noteId)) {
    return null;
  }
  return `/api/notes/${encodeURIComponent(noteId)}`;
}
