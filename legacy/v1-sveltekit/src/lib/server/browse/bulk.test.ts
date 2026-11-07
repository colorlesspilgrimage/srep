import type { DbHandle } from '#lib/server/db/client.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const pgBulk = vi.hoisted(() => ({
  replaceNoteTags: vi.fn(async (): Promise<'ok' | 'not_found' | 'bad_request'> => 'ok'),
  trashNotes: vi.fn(async (): Promise<'ok' | 'not_found' | 'bad_request'> => 'not_found'),
}));

vi.mock('#lib/server/domain/store/note-bulk.pg.js', () => pgBulk);
vi.mock('#lib/server/db/index.js', async () => {
  const { browseHandle } = await import('#lib/server/browse/test-handle.js');
  return { getDb: () => browseHandle() };
});
vi.mock('#lib/server/domain/context.js', () => ({
  getDomainContext: () => ({ now: () => 42 }),
}));

import { replaceNoteTagsBulk, trashNotesBulk } from '#lib/server/browse/bulk.js';
import { setBrowseHandle } from '#lib/server/browse/test-handle.js';

const ID = '123e4567-e89b-42d3-a456-426614174000';

afterEach(() => {
  setBrowseHandle(undefined);
  pgBulk.replaceNoteTags.mockReset();
  pgBulk.trashNotes.mockReset();
  pgBulk.replaceNoteTags.mockResolvedValue('ok');
  pgBulk.trashNotes.mockResolvedValue('not_found');
});

describe('bulk services on postgres', () => {
  it('uses the postgres stores and maps their codes', async () => {
    setBrowseHandle({ dialect: 'postgres', db: { kind: 'pg' } } as unknown as DbHandle);
    expect(await replaceNoteTagsBulk([ID], ['plants'], [])).toEqual({ ok: true });
    expect(pgBulk.replaceNoteTags).toHaveBeenCalledWith({ kind: 'pg' }, [ID], ['plants'], [], 42);
    expect(await trashNotesBulk([ID])).toEqual({ ok: false, status: 404, error: 'not_found' });
    pgBulk.replaceNoteTags.mockResolvedValue('bad_request');
    expect(await replaceNoteTagsBulk([ID], [], [])).toEqual({
      ok: false,
      status: 400,
      error: 'bad_request',
    });
  });
});
