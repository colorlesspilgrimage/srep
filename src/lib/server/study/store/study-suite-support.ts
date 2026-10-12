// Helpers for the study store suite. They work on SQLite and Postgres.
import { sql, type SQL } from 'drizzle-orm';
import type { Failure } from '#lib/server/auth/deps.js';
import { deckRow, execSql } from '#lib/server/domain/store/suite-support.js';
import type { CardRow, CardState, SchedState } from '#lib/server/domain/store/store-types.js';
import { planAnswer, type AnswerPlan } from '#lib/server/study/core/answer-plan.js';
import type { Rating } from '#lib/server/study/core/types.js';
import type { AnswerCardResult } from '#lib/server/study/store/study-store-types.js';
import type { StudyHarness } from '#lib/server/study/test-support/harness.js';

export type MakeStudyHarness = () => Promise<StudyHarness>;

export const DAY_MS = 86_400_000;

type CardPatch = Partial<{
  state: CardState;
  schedState: SchedState;
  due: number;
  reps: number;
  stability: number;
  buriedUntil: number | null;
  deckId: string | null;
  flags: number;
  position: number;
}>;

const COLUMN: Record<keyof CardPatch, string> = {
  state: 'state',
  schedState: 'sched_state',
  due: 'due',
  reps: 'reps',
  stability: 'stability',
  buriedUntil: 'buried_until',
  deckId: 'deck_id',
  flags: 'flags',
  position: 'position',
};

/** Sets card columns with plain SQL. Tests use it for states that only M3 writes. */
export async function setCard(h: StudyHarness, id: string, patch: CardPatch): Promise<void> {
  const sets: SQL[] = Object.entries(patch).map(
    ([key, value]) => sql`${sql.identifier(COLUMN[key as keyof CardPatch])} = ${value}`,
  );
  await execSql(h, sql`update card set ${sql.join(sets, sql`, `)} where id = ${id}`);
}

export async function insertLog(
  h: StudyHarness,
  id: string,
  cardId: string,
  reviewedAt: number,
  stateBefore: SchedState,
): Promise<void> {
  await execSql(
    h,
    sql`insert into review_log (id, card_id, reviewed_at, rating, state_before, due_before,
      stability_before, difficulty_before, elapsed_ms, interval_after)
      values (${id}, ${cardId}, ${reviewedAt}, 3, ${stateBefore}, 0, 0, 0, 1000, 10)`,
  );
}

export async function readCardRow(h: StudyHarness, id: string): Promise<CardRow | undefined> {
  return (await h.studyStore.readCard(id))?.card;
}

export async function addDeckRow(h: StudyHarness, id: string): Promise<void> {
  await h.store.insertDeck(deckRow(id, id.toUpperCase()));
}

export type AnswerOptions = {
  rating?: Rating;
  expectedReps?: number;
  burySiblings?: boolean;
  /** Replaces the planned bury ids. Tests use it to check the store guard. */
  buryIds?: string[];
  fail?: Failure;
};

/** Answers through the store with the real planAnswer and the harness clock. */
export async function answerVia(
  h: StudyHarness,
  cardId: string,
  options: AnswerOptions = {},
): Promise<AnswerCardResult> {
  const nowMs = h.clock.now;
  const window = { dayNumber: 0, startMs: nowMs - DAY_MS / 2, endMs: nowMs + DAY_MS / 2 };
  return h.studyStore.answerCard(cardId, (ctx): AnswerPlan | Failure => {
    if (options.fail !== undefined) {
      return options.fail;
    }
    const plan = planAnswer({
      card: ctx.card,
      preset: { ...ctx.deckPreset, burySiblings: options.burySiblings ?? false },
      siblings: ctx.siblings,
      lastReviewedAtMax: ctx.lastReviewedAtMax,
      rating: options.rating ?? 3,
      expectedReps: options.expectedReps ?? ctx.card.reps,
      elapsedMs: 1000,
      nowMs,
      window,
      logId: `log-${cardId}-${ctx.card.reps}-${nowMs}`,
    });
    if (!plan.ok || options.buryIds === undefined) {
      return plan;
    }
    return { ...plan, buryIds: options.buryIds, log: { ...plan.log, buriedSiblingIds: [] } };
  });
}
