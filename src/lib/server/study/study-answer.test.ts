import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { BASIC_REVERSED_ID } from '#lib/server/domain/builtin.js';
import { FLAG_ORPHANED } from '#lib/server/domain/core/card-plan.js';
import { deleteDeck } from '#lib/server/domain/decks.js';
import { trashNote } from '#lib/server/domain/notes.js';
import { execSql } from '#lib/server/domain/store/suite-support.js';
import { buryCards, suspendCards, unsuspendCards } from '#lib/server/study/card-state.js';
import { answer, undo } from '#lib/server/study/study-answer.js';
import { getNext } from '#lib/server/study/study-next.js';
import {
  addDeck,
  addPreset,
  addStudyNote,
  createStudyHarness,
  STUDY_T0,
  type StudyHarness,
} from '#lib/server/study/test-support/harness.js';
import { queryRows } from '#lib/server/study/test-support/simulation-checks.js';

const MIN = 60_000;
const DAY = 86_400_000;
const UNKNOWN = '123e4567-e89b-42d3-a456-426614174000';

let h: StudyHarness;
afterEach(async () => {
  await h.close();
});

const answerCard = (cardId: string, rating: number, reps: number, elapsedMs = 2500) =>
  answer(h.study, { cardId, rating, reps, elapsedMs });

async function cardRow(id: string) {
  return (await h.studyStore.readCard(id))?.card;
}

async function oneCard() {
  const deck = await addDeck(h, 'Deck');
  const { noteId, cardIds } = await addStudyNote(h, deck.id);
  return { deck, noteId, cardId: cardIds[0] as string };
}

describe('answer', () => {
  it('schedules a new card with FSRS and stores the log row', async () => {
    h = await createStudyHarness();
    const { cardId } = await oneCard();
    const first = await answerCard(cardId, 3, 0, 4321);
    expect(first).toMatchObject({
      ok: true,
      review: { reviewedAt: STUDY_T0, intervalMinutes: 10 },
      card: { id: cardId, state: 'learning', due: STUDY_T0 + 10 * MIN, reps: 1, lapses: 0 },
    });
    h.clock.now = STUDY_T0 + 10 * MIN;
    expect(await answerCard(cardId, 3, 1)).toMatchObject({
      card: { state: 'review', due: Date.parse('2026-01-03T09:10:00Z'), reps: 2 },
    });
    const logs = await queryRows<{ elapsed_ms: number }>(
      h.handle,
      sql`select elapsed_ms from review_log order by reviewed_at`,
    );
    expect(logs.map((l) => Number(l.elapsed_ms))).toEqual([4321, 2500]);
  });

  it('moves a review card to relearning on Again and waits for the relearning step', async () => {
    h = await createStudyHarness();
    const { deck, cardId } = await oneCard();
    await answerCard(cardId, 4, 0);
    const card = await cardRow(cardId);
    h.clock.now = card?.due ?? 0;
    expect(await answerCard(cardId, 1, 1)).toMatchObject({
      card: { state: 'relearning', lapses: 1 },
    });
    expect(await getNext(h.study, { deckId: deck.id })).toMatchObject({
      reply: { status: 'wait', until: h.clock.now + 10 * MIN },
    });
  });

  it('refuses a stale reps value and a suspended card with 409', async () => {
    h = await createStudyHarness();
    const { cardId } = await oneCard();
    expect(await answerCard(cardId, 3, 5)).toEqual({ ok: false, status: 409, error: 'stale_card' });
    await answerCard(cardId, 3, 0);
    expect(await answerCard(cardId, 3, 0)).toMatchObject({ status: 409, error: 'stale_card' });
    await suspendCards(h.study, [cardId]);
    expect(await answerCard(cardId, 3, 1)).toMatchObject({ error: 'card_not_studyable' });
    const logs = await queryRows(h.handle, sql`select id from review_log`);
    expect(logs).toHaveLength(1);
  });

  it('gives 404 for an unknown card, a trashed note and a deleted deck', async () => {
    h = await createStudyHarness();
    expect(await answerCard(UNKNOWN, 3, 0)).toEqual({
      ok: false,
      status: 404,
      error: 'not_found',
    });
    const { noteId, cardId } = await oneCard();
    await trashNote(h.deps, noteId);
    expect(await answerCard(cardId, 3, 0)).toMatchObject({ status: 404 });
    const other = await addDeck(h, 'Other');
    const second = await addStudyNote(h, other.id);
    expect((await deleteDeck(h.deps, other.id, { action: 'trash' })).ok).toBe(true);
    expect(await answerCard(second.cardIds[0] as string, 3, 0)).toMatchObject({ status: 404 });
  });

  it('refuses a bad preset with 422', async () => {
    h = await createStudyHarness();
    const preset = await addPreset(h, { fsrsParams: Array(20).fill(0.5) });
    const deck = await addDeck(h, 'Bad', { presetId: preset.id });
    const { cardIds } = await addStudyNote(h, deck.id);
    expect(await answerCard(cardIds[0] as string, 3, 0)).toMatchObject({
      status: 422,
      error: 'bad_preset',
    });
  });
});

describe('sibling burying', () => {
  it('hides the new sibling for the rest of the day and brings it back after rollover', async () => {
    h = await createStudyHarness();
    const preset = await addPreset(h, { burySiblings: true });
    const deck = await addDeck(h, 'Bury', { presetId: preset.id });
    const { cardIds } = await addStudyNote(h, deck.id, ['a', 'b'], BASIC_REVERSED_ID);
    const [first, sibling] = cardIds as [string, string];
    await answerCard(first, 4, 0);
    expect(await cardRow(sibling)).toMatchObject({
      state: 'buried',
      buriedUntil: Date.parse('2026-01-02T04:00:00Z'),
    });
    expect(await getNext(h.study, { deckId: deck.id })).toMatchObject({
      reply: { status: 'done' },
    });
    h.clock.now += DAY;
    expect(await getNext(h.study, { deckId: deck.id })).toMatchObject({
      reply: { status: 'card', card: { id: sibling, state: 'new' } },
    });
  });
});

describe('undo', () => {
  it('restores the exact card and un-buries the siblings that the answer buried', async () => {
    h = await createStudyHarness();
    const preset = await addPreset(h, { burySiblings: true });
    const deck = await addDeck(h, 'Undo', { presetId: preset.id });
    const { cardIds } = await addStudyNote(h, deck.id, ['a', 'b'], BASIC_REVERSED_ID);
    const before = await Promise.all(cardIds.map((id) => cardRow(id)));
    await answerCard(cardIds[0] as string, 3, 0);
    const result = await undo(h.study);
    expect(result).toMatchObject({ ok: true, undone: { cardId: cardIds[0] } });
    expect(await Promise.all(cardIds.map((id) => cardRow(id)))).toEqual(before);
    expect(await undo(h.study)).toEqual({ ok: false, status: 404, error: 'nothing_to_undo' });
  });
});

describe('suspend, unsuspend and bury', () => {
  it('removes a suspended card from the queue and keeps its schedule', async () => {
    h = await createStudyHarness();
    const { deck, cardId } = await oneCard();
    await answerCard(cardId, 4, 0);
    const scheduled = await cardRow(cardId);
    h.clock.now = (scheduled?.due ?? 0) + MIN;
    expect(await suspendCards(h.study, [cardId])).toEqual({ ok: true });
    expect(await getNext(h.study, { deckId: deck.id })).toMatchObject({
      reply: { status: 'done' },
    });
    expect(await unsuspendCards(h.study, [cardId])).toEqual({ ok: true });
    expect(await cardRow(cardId)).toEqual(scheduled);
    expect(await getNext(h.study, { deckId: deck.id })).toMatchObject({
      reply: { status: 'card', card: { id: cardId, source: 'review' } },
    });
  });

  it('refuses to unsuspend an orphaned cloze card', async () => {
    h = await createStudyHarness();
    const { cardId } = await oneCard();
    await execSql(
      h,
      sql`update card set state = 'suspended', flags = ${FLAG_ORPHANED} where id = ${cardId}`,
    );
    expect(await unsuspendCards(h.study, [cardId])).toEqual({
      ok: false,
      status: 409,
      error: 'card_orphaned',
    });
  });

  it('buries until the next rollover, and an unknown id changes nothing', async () => {
    h = await createStudyHarness();
    const { deck, cardId } = await oneCard();
    expect(await buryCards(h.study, [cardId, UNKNOWN])).toEqual({
      ok: false,
      status: 404,
      error: 'not_found',
    });
    expect((await cardRow(cardId))?.state).toBe('new');
    expect(await buryCards(h.study, [cardId])).toEqual({ ok: true });
    expect(await getNext(h.study, { deckId: deck.id })).toMatchObject({
      reply: { status: 'done' },
    });
    h.clock.now = Date.parse('2026-01-02T04:00:00Z');
    expect(await getNext(h.study, { deckId: deck.id })).toMatchObject({
      reply: { status: 'card', card: { id: cardId } },
    });
  });

  it('works on 500 cards at once', async () => {
    h = await createStudyHarness();
    const deck = await addDeck(h, 'Many');
    const ids: string[] = [];
    for (let i = 0; i < 250; i += 1) {
      ids.push(...(await addStudyNote(h, deck.id, [`a${i}`, 'b'], BASIC_REVERSED_ID)).cardIds);
    }
    expect(ids).toHaveLength(500);
    expect(await suspendCards(h.study, ids)).toEqual({ ok: true });
    const rows = await queryRows<{ n: number }>(
      h.handle,
      sql`select count(*) as n from card where state = 'suspended'`,
    );
    expect(Number(rows[0]?.n)).toBe(500);
  }, 30_000);
});
