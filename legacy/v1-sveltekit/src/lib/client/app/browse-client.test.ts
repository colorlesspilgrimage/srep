import { describe, expect, it } from 'vitest';
import type { ApiResult } from '#lib/client/api.js';
import { createBrowseClient } from './browse-client.js';

const CARD = '123e4567-e89b-42d3-a456-000000000001';
const NOTE = '123e4567-e89b-42d3-a456-000000000011';
const DECK = '123e4567-e89b-42d3-a456-000000000021';

function calls() {
  const seen: { path: string; init?: { method?: string; body?: unknown } }[] = [];
  const fetchJson = async <T>(
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<ApiResult<T>> => {
    seen.push({ path, init });
    return { ok: true, status: 200, body: {} as T };
  };
  return { seen, fetchJson };
}

describe('createBrowseClient', () => {
  it('does not fetch when an id or a query fails the check', async () => {
    const { seen, fetchJson } = calls();
    const client = createBrowseClient(fetchJson);
    expect(await client.search('a'.repeat(501))).toMatchObject({ ok: false, status: 400 });
    expect(await client.search('a\u0000')).toMatchObject({ ok: false });
    expect(await client.move(['bad'], DECK)).toMatchObject({ ok: false });
    expect(await client.move([CARD], 'bad')).toMatchObject({ ok: false });
    expect(await client.suspend(['../x'])).toMatchObject({ ok: false });
    expect(await client.trash([])).toMatchObject({ ok: false });
    expect(await client.setTags({ noteIds: ['bad'], add: ['pets'], remove: [] })).toMatchObject({
      ok: false,
    });
    expect(await client.setTags({ noteIds: [NOTE], add: ['a b'], remove: [] })).toMatchObject({
      ok: false,
    });
    expect(seen).toEqual([]);
  });

  it('sends an encoded search and a JSON body', async () => {
    const { seen, fetchJson } = calls();
    const client = createBrowseClient(fetchJson);
    await client.search('tag:animals <x>');
    await client.listDecks();
    await client.move([CARD], DECK);
    await client.suspend([CARD]);
    await client.setTags({ noteIds: [NOTE], add: ['<script>'], remove: [] });
    await client.trash([NOTE]);
    expect(seen[0]?.path).toBe(`/api/browse?${new URLSearchParams({ q: 'tag:animals <x>' })}`);
    expect(seen[0]?.path).not.toContain('<');
    expect(seen[1]).toEqual({ path: '/api/decks', init: undefined });
    expect(seen[2]?.init).toEqual({ method: 'POST', body: { cardIds: [CARD], deckId: DECK } });
    expect(seen[3]?.init).toEqual({ method: 'POST', body: { cardIds: [CARD] } });
    expect(seen[4]?.init).toEqual({
      method: 'POST',
      body: { noteIds: [NOTE], add: ['<script>'], remove: [] },
    });
    expect(seen[5]?.init).toEqual({ method: 'POST', body: { noteIds: [NOTE] } });
    await client.setTags({ noteIds: [NOTE], add: [], remove: ['pets'] });
    expect(seen[6]?.init).toEqual({
      method: 'POST',
      body: { noteIds: [NOTE], add: [], remove: ['pets'] },
    });
    expect(await client.setTags({ noteIds: [NOTE], add: [], remove: [] })).toMatchObject({
      ok: false,
    });
    expect(seen).toHaveLength(7);
  });
});
