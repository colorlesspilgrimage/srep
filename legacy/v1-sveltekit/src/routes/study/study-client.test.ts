import { describe, expect, it } from 'vitest';
import type { ApiResult } from '#lib/client/api.js';
import { createStudyClient, validNoteFields } from '#lib/client/app/study-client.js';

const ID = '123e4567-e89b-42d3-a456-426614174000';
const NOTE = '223e4567-e89b-42d3-a456-426614174000';

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

describe('createStudyClient', () => {
  it('does not fetch when an id fails the UUID check', async () => {
    const { seen, fetchJson } = calls();
    const client = createStudyClient(fetchJson);
    expect(await client.next('../x')).toMatchObject({ ok: false, status: 400 });
    expect(await client.answer({ cardId: 'bad', rating: 3, reps: 0, elapsedMs: 10 })).toMatchObject(
      {
        ok: false,
      },
    );
    expect(await client.suspend('bad')).toMatchObject({ ok: false });
    expect(await client.getNote('bad')).toMatchObject({ ok: false });
    expect(await client.patchNote('bad', ['a'])).toMatchObject({ ok: false });
    expect(await client.answer({ cardId: ID, rating: 3, reps: -1, elapsedMs: 10 })).toMatchObject({
      ok: false,
    });
    expect(
      await client.answer({ cardId: ID, rating: 3, reps: 0, elapsedMs: 3_600_001 }),
    ).toMatchObject({ ok: false });
    expect(
      await client.answer({ cardId: ID, rating: 3, reps: 1_000_001, elapsedMs: 10 }),
    ).toMatchObject({ ok: false });
    expect(
      await client.answer({ cardId: ID, rating: 3, reps: Number.MAX_SAFE_INTEGER, elapsedMs: 10 }),
    ).toMatchObject({ ok: false });
    expect(await client.patchNote(NOTE, ['a\u0000'])).toMatchObject({ ok: false });
    expect(validNoteFields(['a'.repeat(50_001)])).toBe(false);
    expect(seen).toEqual([]);
  });

  it('sends the encoded path and a JSON body for a UUID', async () => {
    const { seen, fetchJson } = calls();
    const client = createStudyClient(fetchJson);
    await client.next(null);
    await client.next(ID);
    await client.answer({ cardId: ID, rating: 4, reps: 0, elapsedMs: 20 });
    await client.undo();
    await client.suspend(ID);
    await client.getNote(NOTE);
    await client.patchNote(NOTE, ['gato', 'cat']);
    expect(seen.map((call) => call.path)).toEqual([
      '/api/study/next',
      `/api/study/next?deckId=${encodeURIComponent(ID)}`,
      '/api/study/answer',
      '/api/study/undo',
      '/api/cards/suspend',
      `/api/notes/${encodeURIComponent(NOTE)}`,
      `/api/notes/${encodeURIComponent(NOTE)}`,
    ]);
    expect(seen[2]?.init).toEqual({
      method: 'POST',
      body: { cardId: ID, rating: 4, reps: 0, elapsedMs: 20 },
    });
    expect(seen[3]?.init).toEqual({ method: 'POST', body: {} });
    expect(seen[4]?.init).toEqual({ method: 'POST', body: { cardIds: [ID] } });
    expect(seen[6]?.init).toEqual({ method: 'PATCH', body: { fields: ['gato', 'cat'] } });
  });
});
