// Contract: load decks, note types, and one note for the editor.
// A failed request returns its error code. A bad JSON shape is bad_request.
// The client checks ids before it builds a path. No I/O beyond that client.

import type { ApiResult } from '#lib/client/api.js';
import {
  parseDecks,
  parseEditorNote,
  parseTypes,
  type EditorDeck,
  type EditorNote,
  type EditorType,
} from './note-editor-parse.js';

type ListResult =
  { ok: true; decks: EditorDeck[]; types: EditorType[] } | { ok: false; error: string };

type NoteResult = { ok: true; note: EditorNote } | { ok: false; error: string };

type LoadClient = {
  listDecks: () => Promise<ApiResult<unknown>>;
  listNoteTypes: () => Promise<ApiResult<unknown>>;
  getNote: (noteId: string) => Promise<ApiResult<unknown>>;
};

export async function loadEditorLists(client: LoadClient): Promise<ListResult> {
  const [deckResult, typeResult] = await Promise.all([client.listDecks(), client.listNoteTypes()]);
  if (!deckResult.ok) {
    return { ok: false, error: deckResult.error };
  }
  if (!typeResult.ok) {
    return { ok: false, error: typeResult.error };
  }
  const decks = parseDecks(deckResult.body);
  const types = parseTypes(typeResult.body);
  if (decks === null || types === null) {
    return { ok: false, error: 'bad_request' };
  }
  return { ok: true, decks, types };
}

export async function loadEditorNote(client: LoadClient, id: string): Promise<NoteResult> {
  const result = await client.getNote(id);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  const note = parseEditorNote(result.body);
  if (note === null) {
    return { ok: false, error: 'bad_request' };
  }
  return { ok: true, note };
}
