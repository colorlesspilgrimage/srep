// Contract: the deck JSON client.
// A deck id enters a path only after the UUID check, then encodeURIComponent.
// A failed check does not call fetch. The name goes out as JSON, not as a path.
// No shell command is built.

import { apiFetch, rejectedResult, type ApiResult } from '#lib/client/api.js';
import type { DeckClient } from './deck-actions.js';
import { deckResourcePath, isDeckUuid } from './deck-id.js';

type FetchJson = <T>(
  path: string,
  init?: { method?: string; body?: unknown },
) => Promise<ApiResult<T>>;

export function createDeckClient(fetchJson: FetchJson = apiFetch): DeckClient {
  return {
    getDecks: () => fetchJson('/api/decks'),
    getCounts: () => fetchJson('/api/decks/counts'),
    createDeck: (body) => {
      if (body.parentId !== null && !isDeckUuid(body.parentId)) {
        return Promise.resolve(rejectedResult());
      }
      return fetchJson('/api/decks', { method: 'POST', body });
    },
    renameDeck: (id, name) => {
      const path = deckResourcePath(id, 'item');
      if (path === null) {
        return Promise.resolve(rejectedResult());
      }
      return fetchJson(path, { method: 'PATCH', body: { name } });
    },
    deleteDeck: (id, body) => {
      const path = deckResourcePath(id, 'item');
      if (path === null) {
        return Promise.resolve(rejectedResult());
      }
      if (body.action === 'move' && deckResourcePath(body.targetDeckId, 'item') === null) {
        return Promise.resolve(rejectedResult());
      }
      return fetchJson(path, { method: 'DELETE', body });
    },
    readImpact: (id) => {
      const path = deckResourcePath(id, 'impact');
      if (path === null) {
        return Promise.resolve(rejectedResult());
      }
      return fetchJson(path);
    },
  };
}
