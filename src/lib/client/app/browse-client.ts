// Contract: the browse JSON client.
// A search string is set with URLSearchParams. It is not concatenated into the path.
// Ids enter a body only after the UUID check. Tag text is a JSON field.
// A failed check does not call fetch. No shell command is built.

import { apiFetch, rejectedResult, type ApiResult } from '#lib/client/api.js';
import {
  browseSearchPath,
  moveBody,
  suspendBody,
  tagBody,
  trashBody,
  type TagWrite,
} from './browse-model.js';

type FetchJson = <T>(
  path: string,
  init?: { method?: string; body?: unknown },
) => Promise<ApiResult<T>>;

function postIf<T>(
  fetchJson: FetchJson,
  path: string,
  body: unknown | null,
): Promise<ApiResult<T>> {
  if (body === null) {
    return Promise.resolve(rejectedResult());
  }
  return fetchJson(path, { method: 'POST', body });
}

export function createBrowseClient(fetchJson: FetchJson = apiFetch) {
  return {
    search(q: string) {
      const path = browseSearchPath(q);
      if (path === null) {
        return Promise.resolve(rejectedResult());
      }
      return fetchJson<unknown>(path);
    },
    listDecks() {
      return fetchJson<unknown>('/api/decks');
    },
    move(cardIds: readonly string[], deckId: string) {
      return postIf(fetchJson, '/api/cards/move', moveBody(cardIds, deckId));
    },
    suspend(cardIds: readonly string[]) {
      return postIf(fetchJson, '/api/cards/suspend', suspendBody(cardIds));
    },
    setTags(body: TagWrite) {
      const tag = body.add[0] ?? body.remove[0];
      if (tag === undefined) {
        return Promise.resolve(rejectedResult());
      }
      const mode = body.add.length > 0 ? 'add' : 'remove';
      return postIf(fetchJson, '/api/notes/tags', tagBody(body.noteIds, tag, mode));
    },
    trash(noteIds: readonly string[]) {
      return postIf(fetchJson, '/api/notes/trash', trashBody(noteIds));
    },
  };
}
