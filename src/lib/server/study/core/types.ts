// Contract: shared types of the study engine. No logic, no I/O.
import type { SchedState } from '#lib/server/db/schema/sqlite.js';

export type { SchedState };

/** The card columns that the scheduler reads and writes. Times are epoch milliseconds. */
export type SchedFields = {
  schedState: SchedState;
  due: number;
  stability: number;
  difficulty: number;
  lastReview: number | null;
  reps: number;
  lapses: number;
  learningStep: number;
};

/** 1 Again, 2 Hard, 3 Good, 4 Easy. */
export type Rating = 1 | 2 | 3 | 4;

export const RATINGS: readonly Rating[] = [1, 2, 3, 4];

/** The study day starts at rolloverHour:00 local time in the timezone. */
export type StudySettings = { rolloverHour: number; timezone: string };

export const DEFAULT_STUDY_SETTINGS: StudySettings = { rolloverHour: 4, timezone: 'UTC' };

/** One study day: [startMs, endMs). dayNumber counts local study dates from 1970-01-01. */
export type StudyWindow = { dayNumber: number; startMs: number; endMs: number };

/** A review_log row. The *Before fields hold the card values before the answer. */
export type ReviewLogRow = {
  id: string;
  cardId: string;
  reviewedAt: number;
  rating: number;
  stateBefore: SchedState;
  dueBefore: number;
  stabilityBefore: number;
  difficultyBefore: number;
  lastReviewBefore: number | null;
  repsBefore: number;
  lapsesBefore: number;
  stepBefore: number;
  elapsedMs: number;
  /** Whole minutes from reviewedAt to the new due. */
  intervalAfter: number;
  buriedSiblingIds: string[];
};
