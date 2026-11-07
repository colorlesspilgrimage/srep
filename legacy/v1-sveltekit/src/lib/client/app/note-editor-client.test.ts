import { describe, expect, it } from 'vitest';
import type { ApiResult } from '#lib/client/api.js';
import { createNoteEditorClient } from './note-editor-client.js';

const ID = '123e4567-e89b-42d3-a456-426614174000';
const ID2 = '123e4567-e89b-42d3-a456-426614174001';

function harness() {
  const calls: { path: string; init?: { method?: string; body?: unknown } }[] = [];
  const fetchJson = async <T>(
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<ApiResult<T>> => {
    calls.push({ path, init });
    return { ok: true, status: 200, body: { path } as T };
  };
  return { client: createNoteEditorClient(fetchJson), calls };
}

describe('createNoteEditorClient', () => {
  it('loads lists and posts a preview and a note', async () => {
    const { client, calls } = harness();
    await client.listDecks();
    await client.listNoteTypes();
    await client.preview(ID, ['gato', 'cat']);
    await client.createNote({
      noteTypeId: ID,
      deckId: ID2,
      fields: ['gato', 'cat'],
      tags: ['animals'],
    });
    expect(calls.map((call) => call.path)).toEqual([
      '/api/decks',
      '/api/note-types',
      '/api/notes/preview',
      '/api/notes',
    ]);
    expect(calls[2]?.init).toEqual({
      method: 'POST',
      body: { noteTypeId: ID, fields: ['gato', 'cat'] },
    });
    expect(calls[3]?.init?.method).toBe('POST');
  });

  it('reads and patches a note only after the UUID check', async () => {
    const { client, calls } = harness();
    expect(await client.preview('nope', [])).toEqual({
      ok: false,
      status: 400,
      error: 'bad_request',
    });
    expect(await client.getNote('../x')).toEqual({ ok: false, status: 400, error: 'bad_request' });
    expect(
      await client.createNote({ noteTypeId: 'bad', deckId: ID, fields: [], tags: [] }),
    ).toEqual({ ok: false, status: 400, error: 'bad_request' });
    await client.getNote(ID);
    await client.patchNote(ID, { fields: ['a', 'b'], tags: [], deckId: ID2 });
    expect(await client.patchNote(ID, { fields: ['a'], tags: [], deckId: 'bad' })).toMatchObject({
      ok: false,
    });
    expect(calls.map((call) => [call.path, call.init?.method])).toEqual([
      [`/api/notes/${encodeURIComponent(ID)}`, undefined],
      [`/api/notes/${encodeURIComponent(ID)}`, 'PATCH'],
    ]);
  });
});
