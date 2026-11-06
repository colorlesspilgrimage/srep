// Contract: list trashed notes and restore one.
// A restore id enters a path only after the UUID check, then encodeURIComponent.

import { apiFetch, rejectedResult, type ApiResult } from '#lib/client/api.js';
import { encodedUuid } from './deck-id.js';

export type TrashNote = { id: string; preview: string; deletedAt: number };

type FetchJson = <T>(
  path: string,
  init?: { method?: string; body?: unknown },
) => Promise<ApiResult<T>>;

function restorePath(id: string): string | null {
  const encoded = encodedUuid(id);
  if (encoded === null) {
    return null;
  }
  return `/api/notes/${encoded}/restore`;
}

export function createTrashClient(fetchJson: FetchJson = apiFetch) {
  return {
    listTrash() {
      return fetchJson<{ notes: TrashNote[] }>('/api/notes/trash');
    },
    restoreNote(id: string) {
      const path = restorePath(id);
      if (path === null) {
        return Promise.resolve(rejectedResult());
      }
      return fetchJson<{ note: { id: string; deletedAt: number | null } }>(path, {
        method: 'POST',
        body: {},
      });
    },
  };
}

export type TrashClient = ReturnType<typeof createTrashClient>;
