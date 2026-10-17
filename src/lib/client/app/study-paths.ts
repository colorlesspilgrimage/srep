// Contract: study and note URLs.
// A deck id or a note id enters a URL only after the UUID check, then encodeURIComponent.
// A failed check returns null. The caller must not fetch.
// Card ids go in a JSON body, not in a path. No I/O.

import { encodedUuid } from './deck-id.js';

export function studyNextPath(deckId: string | null): string | null {
  if (deckId === null) {
    return '/api/study/next';
  }
  const id = encodedUuid(deckId);
  if (id === null) {
    return null;
  }
  return `/api/study/next?deckId=${id}`;
}

export function studyDeckQuery(deckId: string): string | null {
  return encodedUuid(deckId);
}

export function noteResourcePath(noteId: string): string | null {
  const id = encodedUuid(noteId);
  if (id === null) {
    return null;
  }
  return `/api/notes/${id}`;
}
