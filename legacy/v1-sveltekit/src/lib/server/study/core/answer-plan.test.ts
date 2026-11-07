import { describe, expect, it } from 'vitest';
import type { CardRow } from '#lib/server/domain/store/store-types.js';
import {
  planAnswer,
  planUndo,
  type AnswerInput,
  type AnswerPlan,
} from '#lib/server/study/core/answer-plan.js';
import { answerCard } from '#lib/server/study/core/fsrs-adapter.js';
import { cardRow, TEST_PRESET } from '#lib/server/study/test-support/rows.js';

const NOW = Date.parse('2026-01-01T09:00:00Z');
const WINDOW = { dayNumber: 1, startMs: NOW - 5 * 3_600_000, endMs: NOW + 19 * 3_600_000 };

function input(card: CardRow, patch: Partial<AnswerInput> = {}): AnswerInput {
  return {
    card,
    preset: TEST_PRESET,
    siblings: [],
    lastReviewedAtMax: null,
    rating: 3,
    expectedReps: card.reps,
    elapsedMs: 4000,
    nowMs: NOW,
    window: WINDOW,
    logId: 'log-1',
    ...patch,
  };
}

function plan(card: CardRow, patch: Partial<AnswerInput> = {}): AnswerPlan {
  const result = planAnswer(input(card, patch));
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result;
}

const learning = cardRow('c1', {
  state: 'learning',
  schedState: 'learning',
  due: NOW - 1000,
  stability: 2.3065,
  difficulty: 2.1181,
  lastReview: NOW - 600_000,
  reps: 1,
  learningStep: 1,
});
const review = cardRow('c1', {
  state: 'review',
  schedState: 'review',
  due: NOW - 1000,
  stability: 10.97,
  difficulty: 2.1,
  lastReview: NOW - 11 * 86_400_000,
  reps: 3,
  lapses: 1,
});

describe('planAnswer', () => {
  it('refuses a stale reps value, a suspended or buried card, and a bad preset', () => {
    expect(planAnswer(input(cardRow('c1'), { expectedReps: 1 }))).toEqual({
      ok: false,
      status: 409,
      error: 'stale_card',
    });
    for (const state of ['suspended', 'buried'] as const) {
      expect(planAnswer(input(cardRow('c1', { state })))).toMatchObject({
        status: 409,
        error: 'card_not_studyable',
      });
    }
    const bad = { ...TEST_PRESET, fsrsParams: [1, 2, 3] };
    expect(planAnswer(input(cardRow('c1'), { preset: bad }))).toMatchObject({
      status: 422,
      error: 'bad_preset',
    });
  });

  it('logs the exact BEFORE values of a new, a learning and a review card', () => {
    for (const card of [cardRow('c1'), learning, review]) {
      const { log, cardUpdate } = plan(card, { rating: 2 });
      expect(log).toEqual({
        id: 'log-1',
        cardId: 'c1',
        reviewedAt: NOW,
        rating: 2,
        stateBefore: card.schedState,
        dueBefore: card.due,
        stabilityBefore: card.stability,
        difficultyBefore: card.difficulty,
        lastReviewBefore: card.lastReview,
        repsBefore: card.reps,
        lapsesBefore: card.lapses,
        stepBefore: card.learningStep,
        elapsedMs: 4000,
        intervalAfter: Math.round((cardUpdate.due - NOW) / 60_000),
        buriedSiblingIds: [],
      });
      const expected = answerCard(TEST_PRESET, { ...card }, 2, NOW);
      expect(cardUpdate).toEqual({ ...expected?.fields, state: expected?.fields.schedState });
    }
  });

  it('moves a review card to relearning on Again', () => {
    expect(plan(review, { rating: 1 }).cardUpdate).toMatchObject({
      state: 'relearning',
      schedState: 'relearning',
      lapses: 2,
    });
  });

  it('makes reviewedAt strictly greater than the latest log time', () => {
    expect(plan(cardRow('c1'), { lastReviewedAtMax: NOW - 5 }).log.reviewedAt).toBe(NOW);
    expect(plan(cardRow('c1'), { lastReviewedAtMax: NOW }).log.reviewedAt).toBe(NOW + 1);
    const ahead = plan(cardRow('c1'), { lastReviewedAtMax: NOW + 1000 });
    expect(ahead.log.reviewedAt).toBe(NOW + 1001);
    expect(ahead.cardUpdate.lastReview).toBe(NOW + 1001);
  });

  it('logs the interval in whole minutes', () => {
    expect(plan(cardRow('c1')).log.intervalAfter).toBe(10);
    expect(plan(learning).log.intervalAfter).toBeGreaterThan(24 * 60);
  });

  it('buries only new and review siblings of the same note, when the preset says so', () => {
    const siblings = [
      cardRow('s-new'),
      cardRow('s-review', { state: 'review', schedState: 'review' }),
      cardRow('s-learning', { state: 'learning', schedState: 'learning' }),
      cardRow('s-suspended', { state: 'suspended' }),
      cardRow('s-buried', { state: 'buried' }),
      cardRow('other-note', { noteId: 'n2' }),
    ];
    const on = plan(cardRow('c1'), {
      siblings,
      preset: { ...TEST_PRESET, burySiblings: true },
    });
    expect(on.buryIds).toEqual(['s-new', 's-review']);
    expect(on.log.buriedSiblingIds).toEqual(['s-new', 's-review']);
    expect(on.buryUntil).toBe(WINDOW.endMs);
    expect(plan(cardRow('c1'), { siblings }).buryIds).toEqual([]);
  });
});

describe('planUndo', () => {
  const answered = plan(learning, {
    siblings: [cardRow('s1'), cardRow('s2')],
    preset: { ...TEST_PRESET, burySiblings: true },
  });
  const after = cardRow('c1', { ...answered.cardUpdate });

  it('restores the BEFORE fields and the state', () => {
    const undo = planUndo({ log: answered.log, card: after, buried: [] });
    expect(undo.cardRestore).toEqual({
      schedState: learning.schedState,
      due: learning.due,
      stability: learning.stability,
      difficulty: learning.difficulty,
      lastReview: learning.lastReview,
      reps: learning.reps,
      lapses: learning.lapses,
      learningStep: learning.learningStep,
      state: 'learning',
    });
  });

  it('keeps a suspended or buried state that the user set after the answer', () => {
    for (const state of ['suspended', 'buried'] as const) {
      const undo = planUndo({ log: answered.log, card: { ...after, state }, buried: [] });
      expect(undo.cardRestore.state).toBe(state);
      expect(undo.cardRestore.schedState).toBe('learning');
    }
  });

  it('unburies only the listed siblings that are still buried', () => {
    const buried = [
      cardRow('s1', { state: 'buried' }),
      cardRow('s2', { state: 'suspended' }),
      cardRow('s3', { state: 'buried' }),
    ];
    expect(planUndo({ log: answered.log, card: after, buried }).unburyIds).toEqual(['s1']);
  });
});
