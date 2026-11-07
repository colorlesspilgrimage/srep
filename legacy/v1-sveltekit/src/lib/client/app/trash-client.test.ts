import { describe, expect, it } from 'vitest';
import type { ApiResult } from '#lib/client/api.js';
import { createTrashClient } from './trash-client.js';

const ID = '123e4567-e89b-42d3-a456-426614174000';

function calls(body: unknown = { notes: [] }) {
  const seen: { path: string; init?: { method?: string; body?: unknown } }[] = [];
  let nextBody = body;
  const fetchJson = async <T>(
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<ApiResult<T>> => {
    seen.push({ path, init });
    return { ok: true, status: 200, body: nextBody as T };
  };
  return {
    seen,
    fetchJson,
    setBody(value: unknown) {
      nextBody = value;
    },
  };
}

describe('createTrashClient', () => {
  it('lists trash and restores a UUID id', async () => {
    const { seen, fetchJson, setBody } = calls();
    const client = createTrashClient(fetchJson);
    await client.listTrash();
    expect(seen).toEqual([{ path: '/api/notes/trash', init: undefined }]);
    seen.length = 0;
    setBody({ note: { id: ID, deletedAt: null } });
    await client.restoreNote(ID);
    expect(seen).toEqual([
      {
        path: `/api/notes/${ID}/restore`,
        init: { method: 'POST', body: {} },
      },
    ]);
  });

  it('rejects a hostile restore id without fetching', async () => {
    const { seen, fetchJson } = calls();
    const result = await createTrashClient(fetchJson).restoreNote('../x');
    expect(result).toEqual({ ok: false, status: 400, error: 'bad_request' });
    expect(seen).toEqual([]);
  });
});
