import { describe, expect, it } from 'vitest';
import type { ApiResult } from '#lib/client/api.js';
import { loadDeckScreen, type DeckClient } from './deck-actions.js';

function ok<T>(body: T): ApiResult<T> {
  return { ok: true, status: 200, body };
}

function fail(error: string): ApiResult<never> {
  return { ok: false, status: 400, error };
}

function client(patch: Partial<DeckClient> = {}): DeckClient {
  return {
    getDecks: async () =>
      ok({
        decks: [{ id: 'a', parentId: null, name: 'Languages', archivedAt: null }],
      }),
    getCounts: async () => ok({ counts: [{ id: 'a', subtree: { new: 1, learning: 0, due: 0 } }] }),
    createDeck: async () => ok({ deck: { id: 'b' } }),
    renameDeck: async () => ok({ decks: [] }),
    deleteDeck: async () => ok({ ok: true }),
    readImpact: async () => ok({ decks: 1, cards: 0, notes: 0 }),
    ...patch,
  };
}

describe('loadDeckScreen', () => {
  it('joins the two reads', async () => {
    const result = await loadDeckScreen(client());
    expect(result).toEqual({
      ok: true,
      decks: [
        { id: 'a', parentId: null, name: 'Languages', subtree: { new: 1, learning: 0, due: 0 } },
      ],
    });
  });

  it('returns the deck error and the count error', async () => {
    expect(await loadDeckScreen(client({ getDecks: async () => fail('unauthenticated') }))).toEqual(
      {
        ok: false,
        message: 'Sign in and try again.',
      },
    );
    expect(await loadDeckScreen(client({ getCounts: async () => fail('network_error') }))).toEqual({
      ok: false,
      message: 'The server did not answer.',
    });
  });
});
