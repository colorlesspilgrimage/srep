import type { RequestEvent } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/db/index.js', async () => {
  const { browseHandle } = await import('#lib/server/browse/test-handle.js');
  return { getDb: () => browseHandle() };
});
vi.mock('#lib/server/study/context.js', async () => {
  const { studyRouteState } = await import('#lib/server/study/test-support/route-support.js');
  return { getStudyContext: () => studyRouteState.deps };
});

import { handleAuth } from '#lib/server/auth/hook.js';
import { makeEvent, readBody } from '#lib/server/auth/test-support/route-support.js';
import { createHarness } from '#lib/server/auth/test-support/harness.js';
import { setBrowseHandle } from '#lib/server/browse/test-handle.js';
import type { BrowseRow } from '#lib/server/browse/types.js';
import { BASIC_ID } from '#lib/server/domain/builtin.js';
import { createNote } from '#lib/server/domain/notes.js';
import { execSql } from '#lib/server/domain/store/suite-support.js';
import { SESSION as session } from '#lib/server/domain/test-support/route-support.js';
import { addDeck, type StudyHarness } from '#lib/server/study/test-support/harness.js';
import { useStudyRouteContext } from '#lib/server/study/test-support/route-support.js';
import { GET } from './+server';

let h: StudyHarness | undefined;

afterEach(async () => {
  setBrowseHandle(undefined);
  await h?.close();
  h = undefined;
});

function guestEvent(path: string): RequestEvent {
  const url = new URL(`http://localhost:3000${path}`);
  return {
    url,
    request: new Request(url),
    cookies: { get: () => undefined },
    locals: { session: null },
  } as unknown as RequestEvent;
}

async function open(): Promise<StudyHarness> {
  h = await useStudyRouteContext();
  setBrowseHandle(h.handle);
  return h;
}

async function note(deckId: string, fields: string[], tags: string[]) {
  if (h === undefined) throw new Error('no harness');
  const result = await createNote(h.deps, { noteTypeId: BASIC_ID, deckId, fields, tags });
  if (!result.ok) throw new Error(result.error);
  const cardId = result.note.cards[0]?.id;
  if (cardId === undefined) throw new Error('no card');
  return { noteId: result.note.id, cardId };
}

function get(path: string) {
  return GET(makeEvent(path, { method: 'GET', session }).event);
}

describe('GET /api/browse', () => {
  it('returns 401 for a guest', async () => {
    const auth = await createHarness();
    try {
      const resolve = vi.fn(async () => new Response('no'));
      const response = await handleAuth(
        auth.deps,
        guestEvent('/api/browse?q=tag:animals'),
        resolve,
      );
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'unauthenticated' });
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(resolve).not.toHaveBeenCalled();
      const encoded = await handleAuth(auth.deps, guestEvent('/%61pi/browse'), resolve);
      expect(encoded.status).toBe(401);
      expect(resolve).not.toHaveBeenCalled();
    } finally {
      await auth.handle.close();
    }
  });

  it('returns the three-note fixture for tag:animals', async () => {
    const harness = await open();
    const spanish = await addDeck(harness, 'Spanish');
    const french = await addDeck(harness, 'French');
    await note(spanish.id, ['<b>gato</b>', 'cat'], ['animals']);
    const suspended = await note(french.id, ['chien', 'dog'], ['plants']);
    const lapses = await note(spanish.id, ['perro', 'dog'], ['animals']);
    await execSql(harness, sql`update card set state = 'suspended' where id = ${suspended.cardId}`);
    await execSql(
      harness,
      sql`update card set state = 'review', lapses = 4, due = 1 where id = ${lapses.cardId}`,
    );
    const response = await get(`/api/browse?q=${encodeURIComponent('tag:animals')}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('vary')).toBe('Cookie');
    const body = await readBody<{ rows: BrowseRow[]; nextCursor: string | null }>(response);
    expect(body.nextCursor).toBeNull();
    expect(body.rows.map((row) => row.frontText).sort()).toEqual(['gato', 'perro']);
    const gato = body.rows.find((row) => row.frontText === 'gato');
    expect(gato).toMatchObject({
      deckId: spanish.id,
      deckPath: 'Spanish',
      state: 'new',
      tags: ['animals'],
      lapses: 0,
    });
    expect(typeof gato?.cardId).toBe('string');
    expect(typeof gato?.noteId).toBe('string');
    expect(typeof gato?.due).toBe('number');
  });

  it('rejects a bad query, a bad limit, and a bad cursor, then serves a good query', async () => {
    await open();
    const badQuery = await get(`/api/browse?q=${encodeURIComponent('prop:lapses!')}`);
    expect(badQuery.status).toBe(400);
    expect(await readBody(badQuery)).toEqual({ error: 'bad_query' });
    expect(badQuery.headers.get('cache-control')).toBe('no-store');
    for (const limit of ['0', '101', 'abc', '01']) {
      const response = await get(`/api/browse?limit=${limit}`);
      expect(response.status, limit).toBe(400);
    }
    const cursor = await get(`/api/browse?cursor=${encodeURIComponent('../etc/passwd')}`);
    expect(cursor.status).toBe(400);
    expect(await readBody(cursor)).toEqual({ error: 'bad_query' });
    const again = await get('/api/browse?q=gato');
    expect(again.status).toBe(200);
    expect(await readBody(again)).toEqual({ rows: [], nextCursor: null });
  });

  it('returns the settings error', async () => {
    const harness = await open();
    await execSql(harness, sql`insert into app_settings (key, value) values ('study', '"x"')`);
    const response = await get('/api/browse');
    expect(response.status).toBe(500);
    expect(await readBody(response)).toEqual({ error: 'settings_corrupt' });
    expect(response.headers.get('vary')).toBe('Cookie');
  });
});
