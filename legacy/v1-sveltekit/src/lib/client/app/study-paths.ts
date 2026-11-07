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
