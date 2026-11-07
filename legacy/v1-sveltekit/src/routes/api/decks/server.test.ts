import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/domain/context.js', async () => {
  const { domainRouteState } = await import('#lib/server/domain/test-support/route-support.js');
  return { getDomainContext: () => domainRouteState.deps };
});
import { makeEvent, readBody } from '#lib/server/auth/test-support/route-support.js';
import type { DeckRow } from '#lib/server/domain/store/store-types.js';
import type { DomainHarness } from '#lib/server/domain/test-support/harness.js';
import {
  SESSION as session,
  UNKNOWN_ID,
  useDomainRouteContext,
} from '#lib/server/domain/test-support/route-support.js';
import { GET as list, POST as create } from './+server';
import { DELETE as remove, GET as get, PATCH as patch } from './[id]/+server';
import { GET as impact } from './[id]/impact/+server';

let h: DomainHarness;
afterEach(async () => {
  await h.close();
});

async function post(body: unknown): Promise<Response> {
  return create(makeEvent('/api/decks', { body, session }).event);
}

async function made(name: string, parentId?: string): Promise<DeckRow> {
  const response = await post({ name, parentId });
  expect(response.status).toBe(201);
  return (await readBody<{ deck: DeckRow }>(response)).deck;
}

const at = (id: string, method: string, body?: unknown) =>
  makeEvent(`/api/decks/${id}`, { method, body, params: { id }, session }).event;

describe('deck routes', () => {
  it('creates, lists and reads decks', async () => {
    h = await useDomainRouteContext();
    const root = await made('Languages');
    const child = await made('Japanese', root.id);
    expect(child.path).toBe('Languages::Japanese');
    const all = await readBody<{ decks: DeckRow[] }>(
      await list(makeEvent('/api/decks', { method: 'GET', session }).event),
    );
    expect(all.decks.map((d) => d.path)).toEqual(['Languages', 'Languages::Japanese']);
    const one = await get(at(root.id, 'GET'));
    expect(await readBody(one)).toEqual({ deck: root });
    const dup = await post({ name: 'Japanese', parentId: root.id });
    expect(dup.status).toBe(409);
    expect(await readBody(dup)).toEqual({ error: 'deck_name_taken' });
  });

  it('answers 400 for bad JSON, extra keys and a non-UUID id, and 415 without JSON', async () => {
    h = await useDomainRouteContext();
    const bad = makeEvent('/api/decks', {
      rawBody: '{',
      headers: { 'content-type': 'application/json' },
      session,
    });
    expect((await create(bad.event)).status).toBe(400);
    expect((await post({ name: 'x', extra: 1 })).status).toBe(400);
    const plain = makeEvent('/api/decks', { rawBody: '{"name":"x"}', session });
    expect((await create(plain.event)).status).toBe(415);
    for (const handler of [get, impact]) {
      expect((await handler(at('../x', 'GET'))).status).toBe(400);
    }
    expect((await patch(at('x', 'PATCH', { name: 'y' }))).status).toBe(400);
    expect((await remove(at('x', 'DELETE', { action: 'trash' }))).status).toBe(400);
    expect((await get(at(UNKNOWN_ID, 'GET'))).status).toBe(404);
  });

  it('renames and moves, and refuses a cycle', async () => {
    h = await useDomainRouteContext();
    const a = await made('A');
    const b = await made('B', a.id);
    const renamed = await patch(at(a.id, 'PATCH', { name: 'Lang' }));
    expect((await readBody<{ decks: DeckRow[] }>(renamed)).decks.map((d) => d.path)).toEqual([
      'Lang',
      'Lang::B',
    ]);
    const cycle = await patch(at(a.id, 'PATCH', { parentId: b.id }));
    expect(cycle.status).toBe(409);
    expect(await readBody(cycle)).toEqual({ error: 'deck_cycle' });
    const root = await patch(at(b.id, 'PATCH', { parentId: null }));
    expect((await readBody<{ decks: DeckRow[] }>(root)).decks[0]?.path).toBe('B');
    expect((await patch(at(UNKNOWN_ID, 'PATCH', { name: 'z' }))).status).toBe(404);
  });

  it('reports the impact and deletes with move or trash', async () => {
    h = await useDomainRouteContext();
    const a = await made('A');
    const b = await made('B', a.id);
    const x = await made('X');
    expect(await readBody(await impact(at(a.id, 'GET')))).toEqual({ decks: 2, cards: 0, notes: 0 });
    expect((await impact(at(UNKNOWN_ID, 'GET'))).status).toBe(404);
    for (const body of [
      { action: 'move' },
      { action: 'trash', targetDeckId: x.id },
      {},
      { action: 'burn' },
    ]) {
      expect((await remove(at(a.id, 'DELETE', body))).status).toBe(400);
    }
    const inside = await remove(at(a.id, 'DELETE', { action: 'move', targetDeckId: b.id }));
    expect(inside.status).toBe(409);
    const moved = await remove(at(a.id, 'DELETE', { action: 'move', targetDeckId: x.id }));
    expect(await readBody(moved)).toEqual({ ok: true });
    const trashed = await remove(at(x.id, 'DELETE', { action: 'trash' }));
    expect(trashed.status).toBe(200);
    expect((await remove(at(x.id, 'DELETE', { action: 'trash' }))).status).toBe(404);
  });
});
