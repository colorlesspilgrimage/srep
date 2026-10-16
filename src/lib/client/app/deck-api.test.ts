import { describe, expect, it } from 'vitest';
import type { ApiResult } from '#lib/client/api.js';
import { createDeckClient } from './deck-api.js';

const ID = '123e4567-e89b-42d3-a456-426614174000';
const OTHER = '223e4567-e89b-42d3-a456-426614174000';

function calls() {
  const seen: { path: string; init?: { method?: string; body?: unknown } }[] = [];
  const fetchJson = async <T>(
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<ApiResult<T>> => {
    seen.push({ path, init });
    return { ok: true, status: 200, body: { decks: [], counts: [], deck: { id: 'x' } } as T };
  };
  return { seen, fetchJson };
}

describe('createDeckClient', () => {
  it('does not fetch when the deck id fails the UUID check', async () => {
    const { seen, fetchJson } = calls();
    const client = createDeckClient(fetchJson);
    expect(await client.renameDeck('../x', 'Name')).toEqual({
      ok: false,
      status: 400,
      error: 'bad_request',
    });
    expect(await client.deleteDeck('counts', { action: 'trash' })).toMatchObject({ ok: false });
    expect(await client.deleteDeck(ID, { action: 'move', targetDeckId: '../x' })).toMatchObject({
      ok: false,
    });
    expect(await client.readImpact('not-a-uuid')).toMatchObject({ ok: false });
    expect(seen).toEqual([]);
  });

  it('fetches the encoded path for a UUID', async () => {
    const { seen, fetchJson } = calls();
    const client = createDeckClient(fetchJson);
    await client.getDecks();
    await client.getCounts();
    await client.createDeck({ name: 'Languages', parentId: null });
    await client.renameDeck(ID, 'France');
    await client.deleteDeck(ID, { action: 'trash' });
    await client.deleteDeck(ID, { action: 'move', targetDeckId: OTHER });
    await client.readImpact(ID);
    expect(seen.map((call) => call.path)).toEqual([
      '/api/decks',
      '/api/decks/counts',
      '/api/decks',
      `/api/decks/${ID}`,
      `/api/decks/${ID}`,
      `/api/decks/${ID}`,
      `/api/decks/${ID}/impact`,
    ]);
    expect(seen[3]?.init).toEqual({ method: 'PATCH', body: { name: 'France' } });
    expect(seen[5]?.init).toEqual({
      method: 'DELETE',
      body: { action: 'move', targetDeckId: OTHER },
    });
  });
});
