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
