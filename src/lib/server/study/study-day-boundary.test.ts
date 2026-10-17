import { afterEach, describe, expect, it } from 'vitest';
import { answer } from '#lib/server/study/study-answer.js';
import { getNext, type NextReply } from '#lib/server/study/study-next.js';
import {
  addDeck,
  addPreset,
  addStudyNote,
  createStudyHarness,
  type StudyHarness,
} from '#lib/server/study/test-support/harness.js';

// A Good answer uses a 10-minute learning step.
// The queue waits only when that step is due before the study-day end.
// The default end is 04:00 UTC.

let h: StudyHarness;

afterEach(async () => {
  await h.close();
});

async function goodThenNext(iso: string): Promise<{ before: number; reply: NextReply }> {
  h = await createStudyHarness();
  h.clock.now = Date.parse(iso);
  const preset = await addPreset(h, {});
  const deck = await addDeck(h, 'Boundary', { presetId: preset.id });
  const { cardIds } = await addStudyNote(h, deck.id, ['front', 'back']);
  const before = h.clock.now;
  const answered = await answer(h.study, {
    cardId: cardIds[0] as string,
    rating: 3,
    reps: 0,
    elapsedMs: 4000,
  });
  expect(answered.ok).toBe(true);
  if (!answered.ok) {
    throw new Error('answer failed');
  }
  expect(answered.card.due - before).toBe(10 * 60_000);
  const next = await getNext(h.study, { deckId: deck.id });
  expect(next.ok).toBe(true);
  if (!next.ok) {
    throw new Error('next failed');
  }
  return { before, reply: next.reply };
}

describe('study day boundary', () => {
  it('waits about 10 minutes at 23:30 UTC', async () => {
    const { before, reply } = await goodThenNext('2026-10-16T23:30:00.000Z');
    expect(reply.status).toBe('wait');
    if (reply.status !== 'wait') {
      return;
    }
    const minutes = (reply.until - before) / 60_000;
    expect(minutes).toBeGreaterThan(9);
    expect(minutes).toBeLessThan(11);
  });

  it('is done at 03:50 UTC because the step meets the rollover', async () => {
    const { before, reply } = await goodThenNext('2026-10-17T03:50:00.000Z');
    expect(reply.status).toBe('done');
    if (reply.status !== 'done') {
      return;
    }
    expect(reply.window.endMs).toBe(before + 10 * 60_000);
  });
});
