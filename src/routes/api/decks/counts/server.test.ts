import type { RequestEvent } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/study/context.js', async () => {
  const { studyRouteState } = await import('#lib/server/study/test-support/route-support.js');
  return { getStudyContext: () => studyRouteState.deps };
});

import { handleAuth } from '#lib/server/auth/hook.js';
import { createHarness } from '#lib/server/auth/test-support/harness.js';
import { makeEvent, readBody } from '#lib/server/auth/test-support/route-support.js';
import { execSql } from '#lib/server/domain/store/suite-support.js';
import { SESSION as session } from '#lib/server/domain/test-support/route-support.js';
import type { DeckCountRecord } from '#lib/server/study/core/deck-count-rollup.js';
import {
  addDeck,
  addStudyNote,
  type StudyHarness,
} from '#lib/server/study/test-support/harness.js';
import { useStudyRouteContext } from '#lib/server/study/test-support/route-support.js';
import { GET } from './+server';

let h: StudyHarness | undefined;

afterEach(async () => {
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

describe('GET /api/decks/counts', () => {
  it('a guest gets 401', async () => {
    const auth = await createHarness();
    try {
      const resolve = vi.fn(async () => new Response('no'));
      const response = await handleAuth(auth.deps, guestEvent('/api/decks/counts'), resolve);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'unauthenticated' });
      expect(resolve).not.toHaveBeenCalled();
    } finally {
      await auth.handle.close();
    }
  });

  it('a signed-in caller with three decks gets the rollup', async () => {
    h = await useStudyRouteContext();
    const root = await addDeck(h, 'Languages');
    const mid = await addDeck(h, 'Spanish', { parentId: root.id });
    const leaf = await addDeck(h, 'French', { parentId: mid.id });
    await addStudyNote(h, leaf.id);
    const response = await GET(makeEvent('/api/decks/counts', { method: 'GET', session }).event);
    expect(response.status).toBe(200);
    const body = await readBody<{ counts: DeckCountRecord[] }>(response);
    const byId = new Map(body.counts.map((row) => [row.id, row]));
    for (const id of [root.id, mid.id, leaf.id]) {
      expect(byId.get(id)?.subtree.new).toBe(1);
    }
  });

  it('returns the settings error', async () => {
    h = await useStudyRouteContext();
    await execSql(h, sql`insert into app_settings (key, value) values ('study', '"x"')`);
    const response = await GET(makeEvent('/api/decks/counts', { method: 'GET', session }).event);
    expect(response.status).toBe(500);
    expect(await readBody(response)).toEqual({ error: 'settings_corrupt' });
  });
});
