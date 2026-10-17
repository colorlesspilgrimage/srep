// Contract: note editor URLs.
// A deck id or a note id enters a URL only after the UUID check.
// The id is then encodeURIComponent. A failed check returns null.
// The caller must not fetch. No I/O.

import { isDeckUuid } from './deck-id.js';

function encoded(id: string): string | null {
  if (!isDeckUuid(id)) {
    return null;
  }
  return encodeURIComponent(id);
}

export function newNoteQuery(deckId: string): string | null {
  return encoded(deckId);
}

export function notePagePath(noteId: string): string | null {
  const id = encoded(noteId);
  if (id === null) {
    return null;
  }
  return `/notes/${id}`;
}
