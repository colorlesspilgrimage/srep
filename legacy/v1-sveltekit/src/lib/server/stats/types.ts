import type { SchedState } from '#lib/server/db/schema/sqlite.js';

export type ReviewStatRow = {
  reviewedAt: number;
  rating: number;
  stateBefore: SchedState;
  elapsedMs: number;
  cardId: string;
  deckId: string | null;
  presetId: string | null;
};

export type CardDueRow = {
  due: number;
  schedState: SchedState;
  state: string;
  stability: number;
  lastReview: number | null;
};

export type TodayStats = {
  reviews: number;
  elapsedMs: number;
  again: number;
  hard: number;
  good: number;
  easy: number;
};

export type HeatmapCell = { dayNumber: number; count: number };

export type RetentionStats = {
  matureReviews: number;
  passed: number;
  trueRetention: number | null;
  desiredRetention: number;
};

export type ForecastDay = { dayNumber: number; due: number };

export type DistributionStats = {
  byState: Record<string, number>;
  intervalBuckets: { label: string; count: number }[];
};

export type StreakStats = { current: number; longest: number };
