import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

// vi.mock runs before the static imports, so the factory loads the state module itself.
vi.mock('#lib/server/study/context.js', async () => {
  const { studyRouteState } = await import('#lib/server/study/test-support/route-support.js');
  return { getStudyContext: () => studyRouteState.deps };
});
import { makeEvent, readBody } from '#lib/server/auth/test-support/route-support.js';
import { execSql } from '#lib/server/domain/store/suite-support.js';
import { SESSION as session, UNKNOWN_ID } from '#lib/server/domain/test-support/route-support.js';
import {
  addDeck,
  addStudyNote,
  type StudyHarness,
} from '#lib/server/study/test-support/harness.js';
import { useStudyRouteContext } from '#lib/server/study/test-support/route-support.js';
import { POST as answerRoute } from './answer/+server';
import { GET as nextRoute } from './next/+server';
import { POST as rebuildRoute } from './rebuild/+server';
import { POST as undoRoute } from './undo/+server';
import { GET as verifyRoute } from './verify/+server';

let h: StudyHarness;
afterEach(async () => {
  await h.close();
});

const getNext = (query = '') =>
  nextRoute(makeEvent(`/api/study/next${query}`, { method: 'GET', session }).event);
const postAnswer = (body: unknown, rawBody?: string, headers?: Record<string, string>) =>
  answerRoute(makeEvent('/api/study/answer', { body, rawBody, headers, session }).event);
const postUndo = (body: unknown) =>
  undoRoute(makeEvent('/api/study/undo', { body, session }).event);
const postRebuild = (body: unknown) =>
  rebuildRoute(makeEvent('/api/study/rebuild', { body, session }).event);
const getVerify = () =>
  verifyRoute(makeEvent('/api/study/verify', { method: 'GET', session }).event);

type CardReply = { status: string; card: { id: string; reps: number; previews: object } };

async function setup() {
  h = await useStudyRouteContext();
  const deck = await addDeck(h, 'Routes');
  const { cardIds } = await addStudyNote(h, deck.id);
  return { deckId: deck.id, cardId: cardIds[0] as string };
}

describe('GET /api/study/next', () => {
  it('gives the next card, 400 for a bad query and 404 for an unknown deck', async () => {
    const { deckId, cardId } = await setup();
    const response = await getNext(`?deckId=${deckId}`);
    expect(response.status).toBe(200);
    const reply = await readBody<CardReply>(response);
    expect(reply).toMatchObject({ status: 'card', card: { id: cardId, reps: 0 } });
    expect(Object.keys(reply.card.previews)).toHaveLength(4);
    expect((await getNext()).status).toBe(200);
    for (const query of ['?deckId=nope', '?other=1', `?deckId=${deckId}&x=1`]) {
      const bad = await getNext(query);
      expect(bad.status, query).toBe(400);
      expect(await readBody(bad)).toEqual({ error: 'bad_request' });
    }
    const unknown = await getNext(`?deckId=${UNKNOWN_ID}`);
    expect(unknown.status).toBe(404);
    expect(await readBody(unknown)).toEqual({ error: 'not_found' });
  });

  it('gives 500 with a short code for corrupt settings', async () => {
    await setup();
    await execSql(h, sql`insert into app_settings (key, value) values ('study', '"x"')`);
    const response = await getNext();
    expect(response.status).toBe(500);
    expect(await readBody(response)).toEqual({ error: 'settings_corrupt' });
  });
});

describe('POST /api/study/answer and /api/study/undo', () => {
  it('answers, refuses a stale answer, and undoes', async () => {
    const { cardId } = await setup();
    const body = { cardId, rating: 3, reps: 0, elapsedMs: 1500 };
    const first = await postAnswer(body);
    expect(first.status).toBe(200);
    expect(await readBody(first)).toMatchObject({
      ok: true,
      review: { intervalMinutes: 10 },
      card: { id: cardId, state: 'learning', reps: 1 },
    });
    const stale = await postAnswer(body);
    expect(stale.status).toBe(409);
    expect(await readBody(stale)).toEqual({ error: 'stale_card' });
    const undone = await postUndo({});
    expect(undone.status).toBe(200);
    expect(await readBody(undone)).toMatchObject({ ok: true, undone: { cardId } });
    const nothing = await postUndo({});
    expect(nothing.status).toBe(404);
    expect(await readBody(nothing)).toEqual({ error: 'nothing_to_undo' });
  });

  it('refuses bad bodies with 400 or 415 and no detail', async () => {
    const { cardId } = await setup();
    const valid = { cardId, rating: 3, reps: 0, elapsedMs: 0 };
    for (const body of [
      { ...valid, extra: 1 },
      { ...valid, rating: 0 },
      { ...valid, rating: 5 },
      { ...valid, cardId: 'x' },
      { ...valid, elapsedMs: -1 },
    ]) {
      const response = await postAnswer(body);
      expect(response.status).toBe(400);
      expect(await readBody(response)).toEqual({ error: 'bad_request' });
    }
    const json = { 'content-type': 'application/json' };
    expect((await postAnswer(undefined, '{not json', json)).status).toBe(400);
    const typed = await postAnswer(undefined, JSON.stringify(valid), {
      'content-type': 'text/plain',
    });
    expect(typed.status).toBe(415);
    expect((await postUndo({ a: 1 })).status).toBe(400);
    expect((await postAnswer({ ...valid, cardId: UNKNOWN_ID })).status).toBe(404);
  });
});

describe('GET /api/study/verify and POST /api/study/rebuild', () => {
  it('reports and repairs a damaged card', async () => {
    const { cardId } = await setup();
    await postAnswer({ cardId, rating: 3, reps: 0, elapsedMs: 0 });
    expect(await readBody(await getVerify())).toEqual({
      checked: 1,
      skipped: 0,
      mismatches: [],
      chainMismatches: [],
    });
    await execSql(h, sql`update card set reps = 7 where id = ${cardId}`);
    expect(await readBody(await getVerify())).toMatchObject({
      mismatches: [{ cardId, fields: ['reps'] }],
    });
    expect((await postRebuild({ x: 1 })).status).toBe(400);
    const rebuilt = await postRebuild({});
    expect(rebuilt.status).toBe(200);
    expect(await readBody(rebuilt)).toEqual({ checked: 1, changed: 1, skipped: 0 });
    expect(await readBody(await getVerify())).toMatchObject({ mismatches: [] });
  });
});
