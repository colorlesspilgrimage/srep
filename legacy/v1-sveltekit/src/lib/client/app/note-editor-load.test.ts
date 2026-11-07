import { describe, expect, it, vi } from 'vitest';
import type { ApiResult } from '#lib/client/api.js';
import { loadEditorLists, loadEditorNote } from './note-editor-load.js';

const ID = '123e4567-e89b-42d3-a456-426614174000';

function ok(body: unknown): ApiResult<unknown> {
  return { ok: true, status: 200, body };
}

function fail(error: string): ApiResult<never> {
  return { ok: false, status: 400, error };
}

describe('loadEditorLists', () => {
  it('returns decks and types', async () => {
    const client = {
      listDecks: vi.fn(async () => ok({ decks: [{ id: ID, name: 'Alpha' }] })),
      listNoteTypes: vi.fn(async () =>
        ok({ noteTypes: [{ id: ID, name: 'Basic', fields: ['Front', 'Back'] }] }),
      ),
      getNote: vi.fn(),
    };
    expect(await loadEditorLists(client)).toEqual({
      ok: true,
      decks: [{ id: ID, name: 'Alpha' }],
      types: [{ id: ID, name: 'Basic', fields: ['Front', 'Back'] }],
    });
  });

  it('returns the request error and a bad body', async () => {
    const denied = {
      listDecks: async () => fail('unauthenticated'),
      listNoteTypes: async () => ok({ noteTypes: [] }),
      getNote: async () => fail('not_found'),
    };
    expect(await loadEditorLists(denied)).toEqual({ ok: false, error: 'unauthenticated' });
    const badTypes = {
      listDecks: async () => ok({ decks: [] }),
      listNoteTypes: async () => ok({ noteTypes: [{ id: 'x' }] }),
      getNote: async () => fail('not_found'),
    };
    expect(await loadEditorLists(badTypes)).toEqual({ ok: false, error: 'bad_request' });
    const typeDown = {
      listDecks: async () => ok({ decks: [] }),
      listNoteTypes: async () => fail('network_error'),
      getNote: async () => fail('not_found'),
    };
    expect(await loadEditorLists(typeDown)).toEqual({ ok: false, error: 'network_error' });
  });
});

describe('loadEditorNote', () => {
  it('returns the note or the error', async () => {
    const client = {
      listDecks: async () => fail('x'),
      listNoteTypes: async () => fail('x'),
      getNote: vi.fn(async (): Promise<ApiResult<unknown>> =>
        ok({
          note: {
            id: ID,
            noteTypeId: ID,
            fields: ['gato', 'cat'],
            tags: [],
            duplicates: [],
            cards: [{ deckId: ID }],
          },
        }),
      ),
    };
    expect(await loadEditorNote(client, ID)).toMatchObject({
      ok: true,
      note: { fields: ['gato', 'cat'], deckId: ID },
    });
    client.getNote.mockResolvedValueOnce(fail('not_found'));
    expect(await loadEditorNote(client, ID)).toEqual({ ok: false, error: 'not_found' });
    client.getNote.mockResolvedValueOnce(ok({ note: { id: ID } }));
    expect(await loadEditorNote(client, ID)).toEqual({ ok: false, error: 'bad_request' });
  });
});
