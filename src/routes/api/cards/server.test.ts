import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/domain/context.js', async () => {
  const { domainRouteState } = await import('#lib/server/domain/test-support/route-support.js');
  return { getDomainContext: () => domainRouteState.deps };
});
import { makeEvent, readBody } from '#lib/server/auth/test-support/route-support.js';
import { BASIC_REVERSED_ID } from '#lib/server/domain/builtin.js';
import { createDeck } from '#lib/server/domain/decks.js';
import { createNote } from '#lib/server/domain/notes.js';
import type { DomainHarness } from '#lib/server/domain/test-support/harness.js';
import {
  SESSION as session,
  UNKNOWN_ID,
  useDomainRouteContext,
} from '#lib/server/domain/test-support/route-support.js';
import { POST as move } from './move/+server';

let h: DomainHarness;
afterEach(async () => {
  await h.close();
});

const post = (body: unknown) => move(makeEvent('/api/cards/move', { body, session }).event);

describe('POST /api/cards/move', () => {
  it('moves cards, and moves nothing for an unknown id', async () => {
    h = await useDomainRouteContext();
    const from = await createDeck(h.deps, { name: 'From' });
    const to = await createDeck(h.deps, { name: 'To' });
    if (!from.ok || !to.ok) {
      throw new Error('setup failed');
    }
    const note = await createNote(h.deps, {
      noteTypeId: BASIC_REVERSED_ID,
      deckId: from.deck.id,
      fields: ['a', 'b'],
      tags: [],
    });
    const cardIds = note.ok ? note.note.cards.map((c) => c.id) : [];
    const failed = await post({ cardIds: [...cardIds, UNKNOWN_ID], deckId: to.deck.id });
    expect(failed.status).toBe(404);
    const state = await h.store.getNoteState(note.ok ? note.note.id : '');
    expect(state?.cards.map((c) => c.deckId)).toEqual([from.deck.id, from.deck.id]);
    expect(await readBody(await post({ cardIds, deckId: to.deck.id }))).toEqual({ ok: true });
  });

  it('refuses a bad body', async () => {
    h = await useDomainRouteContext();
    for (const body of [
      { cardIds: [], deckId: UNKNOWN_ID },
      { cardIds: ['x'], deckId: UNKNOWN_ID },
      { deckId: UNKNOWN_ID },
    ]) {
      expect((await post(body)).status).toBe(400);
    }
  });
});
