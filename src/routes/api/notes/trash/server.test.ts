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
  return POST(makeEvent('/api/notes/trash', { body, session }).event);
}

describe('POST /api/notes/trash', () => {
  it('returns 401 for a guest and 403 for a bad CSRF token', async () => {
    const auth = await createHarness();
    try {
      const resolve = vi.fn(async () => new Response('no'));
      const guest = await handleAuth(
        auth.deps,
        guestEvent('/api/notes/trash', 'POST', {
          origin: ORIGIN,
          'content-type': 'application/json',
        }),
        resolve,
      );
      expect(guest.status).toBe(401);
      expect(await guest.json()).toEqual({ error: 'unauthenticated' });
      expect(resolve).not.toHaveBeenCalled();
      const { rawToken } = await createSession(auth.deps, 'ua');
      const event = guestEvent('/api/notes/trash', 'POST', { origin: ORIGIN });
      event.cookies.get = (name: string) => (name === 'srep_session' ? rawToken : undefined);
      const csrf = await handleAuth(auth.deps, event, resolve);
      expect(csrf.status).toBe(403);
      expect(resolve).not.toHaveBeenCalled();
    } finally {
      await auth.handle.close();
    }
  });

  it('trashes every id or none', async () => {
    const harness = await open();
    harness.clock.now = 90;
    const deck = await addDeck(harness, 'Spanish');
    const first = await createNote(harness.deps, {
      noteTypeId: BASIC_ID,
      deckId: deck.id,
      fields: ['gato', 'cat'],
      tags: [],
    });
    const second = await createNote(harness.deps, {
      noteTypeId: BASIC_ID,
      deckId: deck.id,
      fields: ['perro', 'dog'],
      tags: [],
    });
    if (!first.ok || !second.ok) throw new Error('setup failed');
    const missed = await post({ noteIds: [first.note.id, missing] });
    expect(missed.status).toBe(404);
    expect((await harness.store.getNoteState(first.note.id))?.note.deletedAt).toBeNull();
    const ok = await post({ noteIds: [second.note.id] });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(await readBody(ok)).toEqual({ ok: true });
    expect((await harness.store.getNoteState(second.note.id))?.note.deletedAt).toBe(90);
    const again = await post({ noteIds: [second.note.id, first.note.id] });
    expect(again.status).toBe(404);
    expect((await harness.store.getNoteState(first.note.id))?.note.deletedAt).toBeNull();
  });

  it('rejects 0 ids, 101 ids, and a hostile id', async () => {
    const harness = await open();
    const deck = await addDeck(harness, 'Spanish');
    const created = await createNote(harness.deps, {
      noteTypeId: BASIC_ID,
      deckId: deck.id,
      fields: ['gato', 'cat'],
      tags: [],
    });
    if (!created.ok) throw new Error(created.error);
    const id = created.note.id;
    for (const body of [
      {},
      { noteIds: [] },
      { noteIds: [`'; drop table note; --`] },
      { noteIds: [id], extra: true },
      { noteIds: Array.from({ length: 101 }, () => id) },
    ]) {
      expect((await post(body)).status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
    expect((await harness.store.getNoteState(id))?.note.deletedAt).toBeNull();
  });
});
