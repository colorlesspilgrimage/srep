import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleAuth } from '#lib/server/auth/hook.js';
import { createHarness } from '#lib/server/auth/test-support/harness.js';
import { makeEvent, readBody } from '#lib/server/auth/test-support/route-support.js';
import { BASIC_ID } from '#lib/server/domain/builtin.js';
import { countRows } from '#lib/server/domain/store/suite-support.js';
import type { DomainHarness } from '#lib/server/domain/test-support/harness.js';
import {
  SESSION as session,
  UNKNOWN_ID,
  useDomainRouteContext,
} from '#lib/server/domain/test-support/route-support.js';
import { POST } from './+server';

vi.mock('#lib/server/domain/context.js', async () => {
  const { domainRouteState } = await import('#lib/server/domain/test-support/route-support.js');
  return { getDomainContext: () => domainRouteState.deps };
});

let h: DomainHarness | undefined;

afterEach(async () => {
  await h?.close();
  h = undefined;
});

function guestEvent(path: string): RequestEvent {
  const url = new URL(`http://localhost:3000${path}`);
  return {
    url,
    request: new Request(url, { method: 'POST' }),
    cookies: { get: () => undefined },
    locals: { session: null },
  } as unknown as RequestEvent;
}

describe('POST /api/notes/preview', () => {
  it('a guest gets 401', async () => {
    const auth = await createHarness();
    try {
      const resolve = vi.fn(async () => new Response('no'));
      const response = await handleAuth(auth.deps, guestEvent('/api/notes/preview'), resolve);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'unauthenticated' });
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(resolve).not.toHaveBeenCalled();
    } finally {
      await auth.handle.close();
    }
  });

  it('renders a Basic card and a second call does not add a row', async () => {
    h = await useDomainRouteContext();
    const before = await countRows(h, 'note');
    const body = { noteTypeId: BASIC_ID, fields: ['gato', 'cat'] };
    const first = await POST(makeEvent('/api/notes/preview', { body, session }).event);
    expect(first.status).toBe(200);
    expect(await readBody(first)).toEqual({
      cards: [{ templateName: 'Card 1', ordinal: 0, front: 'gato', back: 'gato<hr>cat' }],
    });
    const second = await POST(makeEvent('/api/notes/preview', { body, session }).event);
    expect(second.status).toBe(200);
    expect(await countRows(h, 'note')).toBe(before);
  });

  it('rejects a bad body and a missing note type', async () => {
    h = await useDomainRouteContext();
    const extra = await POST(
      makeEvent('/api/notes/preview', {
        body: { noteTypeId: BASIC_ID, fields: ['a', 'b'], deckId: UNKNOWN_ID },
        session,
      }).event,
    );
    expect(extra.status).toBe(400);
    const badId = await POST(
      makeEvent('/api/notes/preview', { body: { noteTypeId: 'nope', fields: [] }, session }).event,
    );
    expect(badId.status).toBe(400);
    const plain = makeEvent('/api/notes/preview', {
      rawBody: JSON.stringify({ noteTypeId: BASIC_ID, fields: ['a', 'b'] }),
      session,
    });
    expect((await POST(plain.event)).status).toBe(415);
    const missing = await POST(
      makeEvent('/api/notes/preview', {
        body: { noteTypeId: UNKNOWN_ID, fields: ['a', 'b'] },
        session,
      }).event,
    );
    expect(missing.status).toBe(404);
    expect(await readBody(missing)).toEqual({ error: 'not_found' });
  });

  it('rejects a wrong type, a huge field, and an extra key', async () => {
    h = await useDomainRouteContext();
    const cases: unknown[] = [
      { noteTypeId: BASIC_ID, fields: 'gato' },
      { noteTypeId: BASIC_ID, fields: [1, 2] },
      { noteTypeId: 1, fields: ['a', 'b'] },
      { fields: ['a', 'b'] },
      ['a', 'b'],
      { noteTypeId: BASIC_ID, fields: Array.from({ length: 101 }, () => 'a') },
      { noteTypeId: BASIC_ID, fields: ['a'.repeat(50_001), 'b'] },
      { noteTypeId: BASIC_ID, fields: ['a\u0000', 'b'] },
      { noteTypeId: BASIC_ID, fields: ['a', 'b'], deckId: null },
    ];
    for (const body of cases) {
      const response = await POST(makeEvent('/api/notes/preview', { body, session }).event);
      expect(response.status).toBe(400);
      expect(await readBody(response)).toEqual({ error: 'bad_request' });
    }
    const raw = `{"noteTypeId":"${BASIC_ID}","fields":["a","b"],"__proto__":{"admin":true}}`;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.hasOwn(parsed, '__proto__')).toBe(true);
    const proto = await POST(
      makeEvent('/api/notes/preview', {
        rawBody: raw,
        session,
        headers: { 'content-type': 'application/json' },
      }).event,
    );
    expect(proto.status).toBe(400);
  });
});
