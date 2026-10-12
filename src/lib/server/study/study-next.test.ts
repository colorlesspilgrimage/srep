import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { execSql } from '#lib/server/domain/store/suite-support.js';
import { answer, undo } from '#lib/server/study/study-answer.js';
import { getNext, type NextReply } from '#lib/server/study/study-next.js';
import { updateSettings } from '#lib/server/study/study-settings.js';
import {
  addDeck,
  addPreset,
  addStudyNote,
  createStudyHarness,
  STUDY_T0,
  type StudyHarness,
} from '#lib/server/study/test-support/harness.js';

const MIN = 60_000;
const DAY = 86_400_000;

let h: StudyHarness;
afterEach(async () => {
  await h.close();
});

async function next(deckId?: string): Promise<NextReply> {
  const result = await getNext(h.study, deckId === undefined ? {} : { deckId });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.reply;
}

async function answerNext(deckId: string, rating: 1 | 2 | 3 | 4): Promise<string> {
  const reply = await next(deckId);
  if (reply.status !== 'card') {
    throw new Error(`expected a card, got ${reply.status}`);
  }
  const done = await answer(h.study, {
    cardId: reply.card.id,
    rating,
    reps: reply.card.reps,
    elapsedMs: 3000,
  });
  if (!done.ok) {
    throw new Error(done.error);
  }
  return reply.card.id;
}

async function deckWith(notes: number, preset: Parameters<typeof addPreset>[1] = {}) {
  const p = await addPreset(h, preset);
  const deck = await addDeck(h, `Deck ${p.name}`, { presetId: p.id });
  const cards: string[] = [];
  for (let i = 0; i < notes; i += 1) {
    cards.push(...(await addStudyNote(h, deck.id, [`front ${i}`, `back ${i}`])).cardIds);
  }
  return { deck, cards };
}

describe('getNext', () => {
  it('returns a new card with the rendered text, four previews and the counts', async () => {
    h = await createStudyHarness();
    const { deck, cards } = await deckWith(1);
    const reply = await next(deck.id);
    expect(reply).toMatchObject({
      status: 'card',
      card: { id: cards[0], front: 'front 0', back: 'front 0<hr>back 0', source: 'new', reps: 0 },
      counts: { new: 1, learning: 0, review: 0 },
      window: { startMs: Date.parse('2026-01-01T04:00:00Z') },
    });
    if (reply.status !== 'card') throw new Error('no card');
    expect(Object.keys(reply.card.previews)).toEqual(['1', '2', '3', '4']);
    expect(reply.card.previews[3]).toEqual({ due: STUDY_T0 + 10 * MIN, intervalMinutes: 10 });
  });

  it('waits for a learning card, then gives it when the clock reaches its step', async () => {
    h = await createStudyHarness();
    const { deck, cards } = await deckWith(1);
    await answerNext(deck.id, 1);
    expect(await next(deck.id)).toMatchObject({
      status: 'wait',
      until: STUDY_T0 + MIN,
      counts: { learning: 1 },
    });
    h.clock.now = STUDY_T0 + MIN;
    expect(await next(deck.id)).toMatchObject({
      status: 'card',
      card: { id: cards[0], source: 'learning', schedState: 'learning', reps: 1 },
    });
  });

  it('gives done for an empty deck, skips archived decks and refuses an unknown deck', async () => {
    h = await createStudyHarness();
    const empty = await addDeck(h, 'Empty');
    expect(await next(empty.id)).toMatchObject({ status: 'done' });
    const { deck } = await deckWith(1);
    await execSql(h, sql`update deck set archived_at = 1 where id = ${deck.id}`);
    expect(await next(deck.id)).toMatchObject({ status: 'done' });
    expect(await next()).toMatchObject({ status: 'done' });
    const unknown = await getNext(h.study, { deckId: '123e4567-e89b-42d3-a456-426614174000' });
    expect(unknown).toEqual({ ok: false, status: 404, error: 'not_found' });
  });

  it('includes the descendants of the deck', async () => {
    h = await createStudyHarness();
    const parent = await addDeck(h, 'Parent');
    const child = await addDeck(h, 'Child', { parentId: parent.id });
    const other = await addDeck(h, 'Other');
    const { cardIds } = await addStudyNote(h, child.id);
    expect(await next(parent.id)).toMatchObject({ card: { id: cardIds[0] } });
    expect(await next(child.id)).toMatchObject({ card: { id: cardIds[0] } });
    expect(await next(other.id)).toMatchObject({ status: 'done' });
    expect(await next()).toMatchObject({ card: { id: cardIds[0] } });
  });

  it('stops at newPerDay and allows more on the next study day', async () => {
    h = await createStudyHarness();
    const { deck } = await deckWith(3, { newPerDay: 2 });
    await answerNext(deck.id, 4);
    await answerNext(deck.id, 4);
    expect(await next(deck.id)).toMatchObject({ status: 'done', counts: { new: 0 } });
    h.clock.now += DAY;
    expect(await next(deck.id)).toMatchObject({ status: 'card', card: { source: 'new' } });
  });

  it('stops at reviewsPerDay', async () => {
    h = await createStudyHarness();
    const { deck } = await deckWith(2, { reviewsPerDay: 1, learningSteps: [] });
    await answerNext(deck.id, 3);
    await answerNext(deck.id, 3);
    h.clock.now += 5 * DAY;
    expect(await next(deck.id)).toMatchObject({
      counts: { review: 1 },
      card: { source: 'review' },
    });
    await answerNext(deck.id, 3);
    expect(await next(deck.id)).toMatchObject({ status: 'done', counts: { review: 0 } });
  });

  it('counts an answer at 03:59 for the old day and at 04:00 for the new day', async () => {
    h = await createStudyHarness();
    const { deck } = await deckWith(3, { newPerDay: 1 });
    h.clock.now = Date.parse('2026-01-02T03:59:00Z');
    await answerNext(deck.id, 4);
    expect(await next(deck.id)).toMatchObject({ status: 'done' });
    h.clock.now = Date.parse('2026-01-02T04:00:00Z');
    await answerNext(deck.id, 4);
    expect(await next(deck.id)).toMatchObject({ status: 'done' });
  });

  it('moves the day boundary when the time zone changes', async () => {
    h = await createStudyHarness();
    const { deck } = await deckWith(2, { newPerDay: 1 });
    h.clock.now = Date.parse('2026-01-01T18:30:00Z');
    await answerNext(deck.id, 4);
    h.clock.now = Date.parse('2026-01-01T19:00:00Z');
    expect(await next(deck.id)).toMatchObject({ status: 'done' });
    await updateSettings(h.study, { rolloverHour: 4, timezone: 'Asia/Tokyo' });
    // 19:00Z is 04:00 on 2026-01-02 in Tokyo: a new study day.
    expect(await next(deck.id)).toMatchObject({
      status: 'card',
      window: { startMs: Date.parse('2026-01-01T19:00:00Z') },
    });
  });

  it('gives the new slot back after an undo', async () => {
    h = await createStudyHarness();
    const { deck, cards } = await deckWith(2, { newPerDay: 1 });
    await answerNext(deck.id, 4);
    expect(await next(deck.id)).toMatchObject({ status: 'done' });
    expect(await undo(h.study)).toMatchObject({ ok: true, undone: { cardId: cards[0] } });
    expect(await next(deck.id)).toMatchObject({
      status: 'card',
      card: { id: cards[0], reps: 0 },
      counts: { new: 1 },
    });
  });

  it('refuses a preset that ts-fsrs cannot use', async () => {
    h = await createStudyHarness();
    const { deck } = await deckWith(1, { fsrsParams: Array(20).fill(0.5) });
    expect(await getNext(h.study, { deckId: deck.id })).toEqual({
      ok: false,
      status: 422,
      error: 'bad_preset',
    });
  });
});
