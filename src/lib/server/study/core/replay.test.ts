import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CardRow } from '#lib/server/domain/store/store-types.js';
import { planAnswer, schedFieldsOf } from '#lib/server/study/core/answer-plan.js';
import { newCardFields } from '#lib/server/study/core/fsrs-adapter.js';
import { compareSched, replayCard } from '#lib/server/study/core/replay.js';
import type { Rating, ReviewLogRow } from '#lib/server/study/core/types.js';
import { cardRow, TEST_PRESET } from '#lib/server/study/test-support/rows.js';

const T0 = Date.parse('2026-01-01T09:00:00Z');
const WINDOW = { dayNumber: 0, startMs: 0, endMs: 1 };

// Runs the live answer path (planAnswer) and returns the log and the final card.
function liveChain(ratings: Rating[], gaps: number[]): { logs: ReviewLogRow[]; card: CardRow } {
  let card = cardRow('c1', { due: T0 - 5000 });
  let now = T0;
  let last: number | null = null;
  const logs: ReviewLogRow[] = [];
  ratings.forEach((rating, i) => {
    const result = planAnswer({
      card,
      preset: TEST_PRESET,
      siblings: [],
      lastReviewedAtMax: last,
      rating,
      expectedReps: card.reps,
      elapsedMs: 1000,
      nowMs: now,
      window: WINDOW,
      logId: `log-${i}`,
    });
    if (!result.ok) {
      throw new Error(result.error);
    }
    logs.push(result.log);
    card = { ...card, ...result.cardUpdate };
    last = result.log.reviewedAt;
    now += gaps[i] ?? 0;
  });
  return { logs, card };
}

const HOUR = 3_600_000;

describe('replayCard', () => {
  it('equals the live chain', () => {
    const { logs, card } = liveChain([3, 3, 1, 2, 3, 4], [HOUR, 2 * 86_400_000, 0, 600_000, 9e8]);
    const replay = replayCard(logs, TEST_PRESET);
    expect(replay?.chainMismatches).toEqual([]);
    expect(compareSched(schedFieldsOf(card), replay?.fields ?? newCardFields())).toEqual([]);
  });

  it('gives newCardFields for no log, and null for a bad preset', () => {
    expect(replayCard([], TEST_PRESET)).toEqual({ fields: newCardFields(), chainMismatches: [] });
    expect(replayCard([], { ...TEST_PRESET, fsrsParams: [1] })).toBeNull();
  });

  it('finds a tampered rating, a deleted middle row and a changed BEFORE value', () => {
    const { logs, card } = liveChain([3, 3, 3, 3], [HOUR, 3 * 86_400_000, 20 * 86_400_000]);
    const cached = schedFieldsOf(card);
    const tampered = logs.map((l, i) => (i === 3 ? { ...l, rating: 1 } : l));
    expect(compareSched(cached, replayCard(tampered, TEST_PRESET)?.fields ?? cached)).toContain(
      'stability',
    );
    const deleted = logs.filter((_, i) => i !== 1);
    expect(replayCard(deleted, TEST_PRESET)?.chainMismatches).toContain(1);
    const changed = logs.map((l, i) => (i === 2 ? { ...l, stabilityBefore: 99 } : l));
    expect(replayCard(changed, TEST_PRESET)?.chainMismatches).toEqual([2]);
    const outOfRange = logs.map((l, i) => (i === 0 ? { ...l, rating: 7 } : l));
    expect(replayCard(outOfRange, TEST_PRESET)?.chainMismatches).toContain(0);
  });

  it('sorts the rows by reviewedAt', () => {
    const { logs, card } = liveChain([3, 3, 3], [HOUR, 86_400_000]);
    const replay = replayCard([...logs].reverse(), TEST_PRESET);
    expect(replay?.fields).toEqual(schedFieldsOf(card));
  });
});

describe('compareSched', () => {
  it('ignores due while reps is 0 and lists every other difference', () => {
    const fresh = newCardFields();
    expect(compareSched({ ...fresh, due: 123 }, fresh)).toEqual([]);
    expect(compareSched({ ...fresh, reps: 1, due: 5 }, { ...fresh, reps: 1 })).toEqual(['due']);
    expect(compareSched({ ...fresh, stability: 1, learningStep: 2 }, fresh)).toEqual([
      'stability',
      'learningStep',
    ]);
  });
});

describe('replay properties (seeded)', () => {
  it('equals the live chain for random ratings and time gaps', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.constantFrom<Rating>(1, 2, 3, 4), fc.integer({ min: 0, max: 4e9 })), {
          minLength: 1,
          maxLength: 25,
        }),
        (steps) => {
          const { logs, card } = liveChain(
            steps.map((s) => s[0]),
            steps.map((s) => s[1]),
          );
          const replay = replayCard(logs, TEST_PRESET);
          expect(replay?.chainMismatches).toEqual([]);
          expect(replay?.fields).toEqual(schedFieldsOf(card));
        },
      ),
      { seed: 20261012, numRuns: 200 },
    );
  });
});
