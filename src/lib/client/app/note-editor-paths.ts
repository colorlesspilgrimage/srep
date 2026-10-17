// Contract: note editor URLs.
// A deck id or a note id enters a URL only after the UUID check.
// The id is then encodeURIComponent. A failed check returns null.
// The caller must not fetch. No I/O.

import { encodedUuid } from './deck-id.js';

export function newNoteQuery(deckId: string): string | null {
  return encodedUuid(deckId);
}

export function notePagePath(noteId: string): string | null {
  const id = encodedUuid(noteId);
  if (id === null) {
    return null;
  }
  return `/notes/${id}`;
}
