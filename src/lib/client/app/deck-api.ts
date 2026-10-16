// Contract: the deck JSON client.
// A deck id enters a path only after the UUID check, then encodeURIComponent.
// A failed check does not call fetch. The name goes out as JSON, not as a path.
// No shell command is built.

import { apiFetch, type ApiResult } from '#lib/client/api.js';
import type { DeckClient } from './deck-actions.js';
import { deckResourcePath } from './deck-id.js';

type FetchJson = <T>(
  path: string,
  init?: { method?: string; body?: unknown },
) => Promise<ApiResult<T>>;

function rejected(): ApiResult<never> {
  return { ok: false, status: 400, error: 'bad_request' };
}

export function createDeckClient(fetchJson: FetchJson = apiFetch): DeckClient {
  return {
    getDecks: () => fetchJson('/api/decks'),
    getCounts: () => fetchJson('/api/decks/counts'),
    createDeck: (body) => fetchJson('/api/decks', { method: 'POST', body }),
    renameDeck: (id, name) => {
      const path = deckResourcePath(id, 'item');
      if (path === null) {
        return Promise.resolve(rejected());
      }
      return fetchJson(path, { method: 'PATCH', body: { name } });
    },
    deleteDeck: (id, body) => {
      const path = deckResourcePath(id, 'item');
      if (path === null) {
        return Promise.resolve(rejected());
      }
      if (body.action === 'move' && deckResourcePath(body.targetDeckId, 'item') === null) {
        return Promise.resolve(rejected());
      }
      return fetchJson(path, { method: 'DELETE', body });
    },
    readImpact: (id) => {
      const path = deckResourcePath(id, 'impact');
      if (path === null) {
        return Promise.resolve(rejected());
      }
      return fetchJson(path);
    },
  };
}
