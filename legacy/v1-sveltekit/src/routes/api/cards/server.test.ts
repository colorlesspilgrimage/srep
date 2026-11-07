import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/domain/context.js', async () => {
  const { domainRouteState } = await import('#lib/server/domain/test-support/route-support.js');
  return { getDomainContext: () => domainRouteState.deps };
});
vi.mock('#lib/server/study/context.js', async () => {
  const { studyRouteState } = await import('#lib/server/study/test-support/route-support.js');
  return { getStudyContext: () => studyRouteState.deps };
});
import { sql } from 'drizzle-orm';
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
import { FLAG_ORPHANED } from '#lib/server/domain/core/card-plan.js';
import { execSql } from '#lib/server/domain/store/suite-support.js';
import { addDeck, addStudyNote } from '#lib/server/study/test-support/harness.js';
import { useStudyRouteContext } from '#lib/server/study/test-support/route-support.js';
import { POST as bury } from './bury/+server';
import { POST as move } from './move/+server';
import { POST as suspend } from './suspend/+server';
import { POST as unsuspend } from './unsuspend/+server';

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

const stateRoutes = { suspend, unsuspend, bury };
const postState = (name: keyof typeof stateRoutes, body: unknown) =>
  stateRoutes[name](makeEvent(`/api/cards/${name}`, { body, session }).event);

describe('POST /api/cards/{suspend,unsuspend,bury}', () => {
  async function twoCards() {
    const s = await useStudyRouteContext();
    h = s;
    const deck = await addDeck(s, 'State');
    const { noteId, cardIds } = await addStudyNote(s, deck.id, ['a', 'b'], BASIC_REVERSED_ID);
    const states = async () => (await s.store.getNoteState(noteId))?.cards.map((c) => c.state);
    return { s, cardIds, states };
  }

  it('suspends, unsuspends and buries in bulk, all or nothing', async () => {
    const { cardIds, states } = await twoCards();
    const unknown = await postState('suspend', { cardIds: [...cardIds, UNKNOWN_ID] });
    expect(unknown.status).toBe(404);
    expect(await readBody(unknown)).toEqual({ error: 'not_found' });
    expect(await states()).toEqual(['new', 'new']);
    expect(await readBody(await postState('suspend', { cardIds }))).toEqual({ ok: true });
    expect(await states()).toEqual(['suspended', 'suspended']);
    expect((await postState('unsuspend', { cardIds })).status).toBe(200);
    expect(await states()).toEqual(['new', 'new']);
    expect((await postState('bury', { cardIds: [cardIds[0]] })).status).toBe(200);
    expect(await states()).toEqual(['buried', 'new']);
  });

  it('refuses to unsuspend an orphaned card with 409', async () => {
    const { s, cardIds } = await twoCards();
    const id = cardIds[0] as string;
    await execSql(
      s,
      sql`update card set state = 'suspended', flags = ${FLAG_ORPHANED} where id = ${id}`,
    );
    const response = await postState('unsuspend', { cardIds: [id] });
    expect(response.status).toBe(409);
    expect(await readBody(response)).toEqual({ error: 'card_orphaned' });
  });

  it('refuses a bad body', async () => {
    await twoCards();
    for (const name of ['suspend', 'unsuspend', 'bury'] as const) {
      for (const body of [
        { cardIds: [] },
        { cardIds: ['x'] },
        { cardIds: Array(501).fill(UNKNOWN_ID) },
        { cardIds: [UNKNOWN_ID], extra: 1 },
        {},
      ]) {
        const response = await postState(name, body);
        expect(response.status, `${name} ${JSON.stringify(body).slice(0, 40)}`).toBe(400);
        expect(await readBody(response)).toEqual({ error: 'bad_request' });
      }
    }
  });
});
