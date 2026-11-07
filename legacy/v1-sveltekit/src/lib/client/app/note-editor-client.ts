import { apiFetch, rejectedResult, type ApiResult } from '#lib/client/api.js';
import { isDeckUuid } from './deck-id.js';
import { noteResourcePath } from './study-paths.js';

export type NoteCreateBody = {
  noteTypeId: string;
  deckId: string;
  fields: string[];
  tags: string[];
};

export type NotePatchBody = {
  fields: string[];
  tags: string[];
  deckId: string;
};

type FetchJson = <T>(
  path: string,
  init?: { method?: string; body?: unknown },
) => Promise<ApiResult<T>>;

export function createNoteEditorClient(fetchJson: FetchJson = apiFetch) {
  return {
    listDecks() {
      return fetchJson('/api/decks');
    },
    listNoteTypes() {
      return fetchJson('/api/note-types');
    },
    preview(noteTypeId: string, fields: readonly string[]) {
      if (!isDeckUuid(noteTypeId)) {
        return Promise.resolve(rejectedResult());
      }
      return fetchJson('/api/notes/preview', {
        method: 'POST',
        body: { noteTypeId, fields: [...fields] },
      });
    },
    createNote(body: NoteCreateBody) {
      if (!isDeckUuid(body.noteTypeId) || !isDeckUuid(body.deckId)) {
        return Promise.resolve(rejectedResult());
      }
      return fetchJson('/api/notes', { method: 'POST', body });
    },
    getNote(noteId: string) {
      const path = noteResourcePath(noteId);
      if (path === null) {
        return Promise.resolve(rejectedResult());
      }
      return fetchJson(path);
    },
    patchNote(noteId: string, body: NotePatchBody) {
      const path = noteResourcePath(noteId);
      if (path === null || !isDeckUuid(body.deckId)) {
        return Promise.resolve(rejectedResult());
      }
      return fetchJson(path, { method: 'PATCH', body });
    },
  };
}
