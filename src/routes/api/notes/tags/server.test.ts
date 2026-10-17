import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/db/index.js', async () => {
  const { browseHandle } = await import('#lib/server/browse/test-handle.js');
  return { getDb: () => browseHandle() };
});
vi.mock('#lib/server/domain/context.js', async () => {
  const { domainRouteState } = await import('#lib/server/domain/test-support/route-support.js');
  return { getDomainContext: () => domainRouteState.deps };
});

import { handleAuth } from '#lib/server/auth/hook.js';
import { createSession } from '#lib/server/auth/sessions.js';
import { createHarness } from '#lib/server/auth/test-support/harness.js';
import { makeEvent, readBody } from '#lib/server/auth/test-support/route-support.js';
import { csrfTokenFor } from '#lib/server/auth/tokens.js';
import { setBrowseHandle } from '#lib/server/browse/test-handle.js';
import { BASIC_ID } from '#lib/server/domain/builtin.js';
import { createNote } from '#lib/server/domain/notes.js';
import { SESSION as session } from '#lib/server/domain/test-support/route-support.js';
import { addDeck, type StudyHarness } from '#lib/server/study/test-support/harness.js';
import { useStudyRouteContext } from '#lib/server/study/test-support/route-support.js';
import { POST } from './+server';

const ORIGIN = 'http://localhost:3000';
const missing = '123e4567-e89b-42d3-a456-426614174000';

let h: StudyHarness | undefined;

afterEach(async () => {
  setBrowseHandle(undefined);
  await h?.close();
  h = undefined;
});

function guestEvent(
  path: string,
  method: string,
  headers: Record<string, string> = {},
): RequestEvent {
  const url = new URL(ORIGIN + path);
  return {
    url,
    request: new Request(url, { method, headers }),
    cookies: { get: () => undefined },
    locals: { session: null },
  } as unknown as RequestEvent;
}

async function open(): Promise<StudyHarness> {
  h = await useStudyRouteContext();
  setBrowseHandle(h.handle);
  return h;
}

function post(body: unknown) {
  return POST(makeEvent('/api/notes/tags', { body, session }).event);
}

describe('POST /api/notes/tags', () => {
  it('returns 401 for a guest and 403 for a bad CSRF token', async () => {
    const auth = await createHarness();
    try {
      const resolve = vi.fn(async () => new Response('no'));
      const guest = await handleAuth(
        auth.deps,
        guestEvent('/api/notes/tags', 'POST', {
          origin: ORIGIN,
          'content-type': 'application/json',
          'x-srep-csrf': 'nope',
        }),
        resolve,
      );
      expect(guest.status).toBe(401);
      expect(await guest.json()).toEqual({ error: 'unauthenticated' });
      expect(guest.headers.get('cache-control')).toBe('no-store');
      expect(resolve).not.toHaveBeenCalled();
      const encoded = await handleAuth(auth.deps, guestEvent('/%61pi/notes/tags', 'POST'), resolve);
      expect(encoded.status).toBe(401);
      const { rawToken } = await createSession(auth.deps, 'ua');
      const event = guestEvent('/api/notes/tags', 'POST', {
        origin: ORIGIN,
        'x-srep-csrf': 'wrong',
      });
      event.cookies.get = (name: string) => (name === 'srep_session' ? rawToken : undefined);
      const csrf = await handleAuth(auth.deps, event, resolve);
      expect(csrf.status).toBe(403);
      expect(await csrf.json()).toEqual({ error: 'bad_csrf' });
      expect(csrfTokenFor(rawToken)).not.toBe('wrong');
      const badOrigin = guestEvent('/api/notes/tags', 'POST', {
        origin: 'http://evil.example',
        'x-srep-csrf': csrfTokenFor(rawToken),
      });
      badOrigin.cookies.get = (name: string) => (name === 'srep_session' ? rawToken : undefined);
      const origin = await handleAuth(auth.deps, badOrigin, resolve);
      expect(origin.status).toBe(403);
      expect(await origin.json()).toEqual({ error: 'bad_origin' });
      expect(resolve).not.toHaveBeenCalled();
    } finally {
      await auth.handle.close();
    }
  });

  it('adds a tag or changes nothing', async () => {
    const harness = await open();
    harness.clock.now = 80;
    const deck = await addDeck(harness, 'Spanish');
    const created = await createNote(harness.deps, {
      noteTypeId: BASIC_ID,
      deckId: deck.id,
      fields: ['gato', 'cat'],
      tags: ['animals'],
    });
    if (!created.ok) throw new Error(created.error);
    const id = created.note.id;
    const missed = await post({ noteIds: [id, missing], add: ['plants'], remove: [] });
    expect(missed.status).toBe(404);
    expect(await readBody(missed)).toEqual({ error: 'not_found' });
    expect((await harness.store.getNoteState(id))?.tags).toEqual(['animals']);
    const ok = await post({ noteIds: [id], add: ['plants'], remove: ['animals'] });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(ok.headers.get('vary')).toBe('Cookie');
    expect(await readBody(ok)).toEqual({ ok: true });
    const state = await harness.store.getNoteState(id);
    expect(state?.tags).toEqual(['plants']);
    expect(state?.note.updatedAt).toBe(80);
    const bad = await post({ noteIds: [id], add: ['bad tag'], remove: [] });
    expect(bad.status).toBe(400);
    expect(await readBody(bad)).toEqual({ error: 'bad_request' });
    expect((await harness.store.getNoteState(id))?.tags).toEqual(['plants']);
  });

  it('rejects a hostile or empty body', async () => {
    const harness = await open();
    const deck = await addDeck(harness, 'Spanish');
    const created = await createNote(harness.deps, {
      noteTypeId: BASIC_ID,
      deckId: deck.id,
      fields: ['gato', 'cat'],
      tags: ['animals'],
    });
    if (!created.ok) throw new Error(created.error);
    const id = created.note.id;
    for (const body of [
      {},
      { noteIds: [], add: [], remove: [] },
      { noteIds: [`'; drop table note; --`], add: [], remove: [] },
      { noteIds: [id], add: ['a\u0000'], remove: [] },
      { noteIds: [id], add: [], remove: [], extra: 1 },
      { noteIds: Array.from({ length: 101 }, () => id), add: [], remove: [] },
      { noteIds: [id], add: ['x'.repeat(201)], remove: [] },
    ]) {
      const response = await post(body);
      expect(response.status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
    expect((await harness.store.getNoteState(id))?.tags).toEqual(['animals']);
    const raw = await POST(
      makeEvent('/api/notes/tags', {
        rawBody: '{',
        session,
        headers: { 'content-type': 'application/json' },
      }).event,
    );
    expect(raw.status).toBe(400);
  });

  it('sets private cache headers on a rejected body', async () => {
    const bad = await post({});
    expect(bad.status).toBe(400);
    expect(bad.headers.get('cache-control')).toBe('no-store');
    expect(bad.headers.get('vary')).toBe('Cookie');
    const typed = await POST(
      makeEvent('/api/notes/tags', {
        rawBody: 'x',
        session,
        headers: { 'content-type': 'text/plain' },
      }).event,
    );
    expect(typed.status).toBe(415);
    expect(typed.headers.get('cache-control')).toBe('no-store');
    expect(typed.headers.get('vary')).toBe('Cookie');
  });
});
