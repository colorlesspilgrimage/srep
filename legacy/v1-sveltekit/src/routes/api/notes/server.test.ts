import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/domain/context.js', async () => {
  const { domainRouteState } = await import('#lib/server/domain/test-support/route-support.js');
  return { getDomainContext: () => domainRouteState.deps };
});
import { makeEvent, readBody } from '#lib/server/auth/test-support/route-support.js';
import { BASIC_ID, CLOZE_ID } from '#lib/server/domain/builtin.js';
import { createDeck } from '#lib/server/domain/decks.js';
import type { NoteView } from '#lib/server/domain/notes.js';
import type { DomainHarness } from '#lib/server/domain/test-support/harness.js';
import {
  SESSION as session,
  UNKNOWN_ID,
  useDomainRouteContext,
} from '#lib/server/domain/test-support/route-support.js';
import { POST as create } from './+server';
import { DELETE as remove, GET as get, PATCH as patch } from './[id]/+server';
import { POST as restore } from './[id]/restore/+server';

let h: DomainHarness;
let deckId: string;
afterEach(async () => {
  await h.close();
});

async function setup(): Promise<void> {
  h = await useDomainRouteContext();
  const deck = await createDeck(h.deps, { name: 'Main' });
  deckId = deck.ok ? deck.deck.id : '';
}

const post = (body: unknown) => create(makeEvent('/api/notes', { body, session }).event);
const at = (id: string, method: string, body?: unknown, suffix = '') =>
  makeEvent(`/api/notes/${id}${suffix}`, { method, body, params: { id }, session }).event;

async function made(noteTypeId: string, fields: string[]): Promise<NoteView> {
  const response = await post({ noteTypeId, deckId, fields, tags: ['Zoo', 'animals'] });
  expect(response.status).toBe(201);
  return (await readBody<{ note: NoteView }>(response)).note;
}

describe('note routes', () => {
  it('creates a note with rendered cards and reads it back', async () => {
    await setup();
    const note = await made(CLOZE_ID, ['{{c1::Tokyo}} is the capital of {{c2::Japan}}', '']);
    expect(note.tags).toEqual(['animals', 'zoo']);
    expect(note.cards.map((c) => c.front)).toEqual([
      '<span class="cloze">[...]</span> is the capital of Japan',
      'Tokyo is the capital of <span class="cloze">[...]</span>',
    ]);
    expect(await readBody(await get(at(note.id, 'GET')))).toEqual({ note });
  });

  it('edits, trashes and restores a note', async () => {
    await setup();
    const note = await made(BASIC_ID, ['dog', 'Hund']);
    const edited = await readBody<{ note: NoteView }>(
      await patch(at(note.id, 'PATCH', { fields: ['cat', 'Katze'] })),
    );
    expect(edited.note.cards[0]?.front).toBe('cat');
    expect(await readBody(await remove(at(note.id, 'DELETE')))).toEqual({ ok: true });
    expect((await patch(at(note.id, 'PATCH', { tags: [] }))).status).toBe(404);
    const restored = await restore(at(note.id, 'POST', {}, '/restore'));
    expect((await readBody<{ note: NoteView }>(restored)).note.deletedAt).toBeNull();
    expect((await restore(at(note.id, 'POST', {}, '/restore'))).status).toBe(404);
  });

  it('answers the error codes', async () => {
    await setup();
    const base = { noteTypeId: BASIC_ID, deckId, fields: ['a', 'b'] };
    expect(await readBody(await post({ ...base, fields: ['a'] }))).toEqual({
      error: 'field_count_mismatch',
    });
    expect(await readBody(await post({ ...base, tags: ['a b'] }))).toEqual({
      error: 'invalid_tag',
    });
    const media = await post({ ...base, fields: [`{{media:${'a'.repeat(64)}}}`, ''] });
    expect(await readBody(media)).toEqual({ error: 'unknown_media' });
    expect((await post({ ...base, extra: 1 })).status).toBe(400);
    expect((await post({ ...base, deckId: UNKNOWN_ID })).status).toBe(404);
    const plain = makeEvent('/api/notes', { rawBody: JSON.stringify(base), session });
    expect((await create(plain.event)).status).toBe(415);
    for (const response of [
      await get(at('x', 'GET')),
      await patch(at('x', 'PATCH', {})),
      await remove(at('x', 'DELETE')),
      await restore(at('x', 'POST', {}, '/restore')),
      await restore(at(UNKNOWN_ID, 'POST', { extra: 1 }, '/restore')),
      await patch(at(UNKNOWN_ID, 'PATCH', { extra: 1 })),
    ]) {
      expect(response.status).toBe(400);
    }
    expect((await get(at(UNKNOWN_ID, 'GET'))).status).toBe(404);
    expect((await remove(at(UNKNOWN_ID, 'DELETE'))).status).toBe(404);
  });
});
