import { describe, expect, it } from 'vitest';
import {
  buildHeatmap,
  computeRetention,
  forecastDue,
  studyStreak,
  summarizeToday,
} from '#lib/server/stats/metrics/pure.js';
import { studyWindow } from '#lib/server/study/core/day-clock.js';
import type { CardDueRow, ReviewStatRow } from '#lib/server/stats/types.js';

const SETTINGS = { rolloverHour: 4, timezone: 'UTC' };
const T0 = Date.parse('2026-01-10T12:00:00Z');

const REVIEWS: ReviewStatRow[] = [
  {
    reviewedAt: T0,
    rating: 3,
    stateBefore: 'review',
    elapsedMs: 1000,
    cardId: 'c1',
    deckId: 'd1',
    presetId: 'p1',
  },
  {
    reviewedAt: T0 + 3_600_000,
    rating: 1,
    stateBefore: 'review',
    elapsedMs: 2000,
    cardId: 'c2',
    deckId: 'd1',
    presetId: 'p1',
  },
  {
    reviewedAt: T0 - 86_400_000,
    rating: 4,
    stateBefore: 'learning',
    elapsedMs: 500,
    cardId: 'c3',
    deckId: 'd1',
    presetId: 'p1',
  },
];

describe('stats pure metrics', () => {
  it('summarizes today ratings', () => {
    expect(summarizeToday(REVIEWS.slice(0, 2))).toEqual({
      reviews: 2,
      elapsedMs: 3000,
      again: 1,
      hard: 0,
      good: 1,
      easy: 0,
    });
  });

  it('computes mature retention', () => {
    expect(computeRetention(REVIEWS, 0.9, null)).toEqual({
      matureReviews: 2,
      passed: 1,
      trueRetention: 0.5,
      desiredRetention: 0.9,
    });
  });

  it('builds heatmap counts by study day', () => {
    const day = studyWindow(T0, SETTINGS).dayNumber;
    const cells = buildHeatmap(REVIEWS, SETTINGS, day - 2, day);
    const nonzero = cells.filter((c) => c.count > 0);
    expect(nonzero.length).toBeGreaterThan(0);
    expect(cells.reduce((sum, c) => sum + c.count, 0)).toBe(3);
  });

  it('forecasts due cards by day', () => {
    const cards: CardDueRow[] = [
      {
        due: T0 + 2 * 86_400_000,
        schedState: 'review',
        state: 'review',
        stability: 5,
        lastReview: T0,
      },
    ];
    const days = forecastDue(cards, SETTINGS, T0, 7);
    expect(days.reduce((sum, d) => sum + d.due, 0)).toBeGreaterThan(0);
  });

  it('counts study streak', () => {
    const streak = studyStreak(REVIEWS, SETTINGS, T0);
    expect(streak.longest).toBeGreaterThanOrEqual(1);
  });

  it('matches oracle fixture', () => {
    const oracle = summarizeToday(REVIEWS);
    expect(oracle).toEqual({
      reviews: 3,
      elapsedMs: 3500,
      again: 1,
      hard: 0,
      good: 1,
      easy: 1,
    });
    expect(computeRetention(REVIEWS, 0.9, 'p1').trueRetention).toBe(0.5);
  });
});
