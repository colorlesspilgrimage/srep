// Contract: answer schedules one card with FSRS and appends a review_log row. undo reverts
// the most recent review. Both run in one store transaction under the study lock.
// answer errors: 404 not_found (unknown card, trashed note, no deck), 409 stale_card,
// 409 card_not_studyable, 422 bad_preset, 500 settings_corrupt.
// undo errors: 404 nothing_to_undo. Side effect of both: expired buried cards come back.
import { fail, type Result } from '#lib/server/auth/deps.js';
import { newId } from '#lib/server/domain/ids.js';
import { planAnswer, planUndo } from '#lib/server/study/core/answer-plan.js';
import { studyWindow } from '#lib/server/study/core/day-clock.js';
import type { Rating, SchedState } from '#lib/server/study/core/types.js';
import type { AnswerBody } from '#lib/server/study/core/validation.js';
import type { StudyDeps } from '#lib/server/study/deps.js';
import { getSettings } from '#lib/server/study/study-settings.js';

export type AnswerReply = {
  review: { id: string; reviewedAt: number; intervalMinutes: number };
  card: {
    id: string;
    state: SchedState;
    due: number;
    reps: number;
    lapses: number;
    stability: number;
    difficulty: number;
  };
};

export async function answer(deps: StudyDeps, input: AnswerBody): Promise<Result<AnswerReply>> {
  const settings = await getSettings(deps);
  if (!settings.ok) {
    return settings;
  }
  const nowMs = deps.now();
  const window = studyWindow(nowMs, settings.settings);
  await deps.store.unburyExpired(nowMs);
  const logId = newId(deps.random);
  const result = await deps.store.answerCard(input.cardId, (ctx) =>
    planAnswer({
      card: ctx.card,
      preset: ctx.deckPreset,
      siblings: ctx.siblings,
      lastReviewedAtMax: ctx.lastReviewedAtMax,
      // The schema bounds rating to 1..4.
      rating: input.rating as Rating,
      expectedReps: input.reps,
      elapsedMs: input.elapsedMs,
      nowMs,
      window,
      logId,
    }),
  );
  if (result === 'not_found') {
    return fail(404, 'not_found');
  }
  if (!result.ok) {
    return result;
  }
  const { log, cardUpdate } = result.plan;
  return {
    ok: true,
    review: { id: log.id, reviewedAt: log.reviewedAt, intervalMinutes: log.intervalAfter },
    card: {
      id: log.cardId,
      state: cardUpdate.state,
      due: cardUpdate.due,
      reps: cardUpdate.reps,
      lapses: cardUpdate.lapses,
      stability: cardUpdate.stability,
      difficulty: cardUpdate.difficulty,
    },
  };
}

export async function undo(
  deps: StudyDeps,
): Promise<Result<{ undone: { reviewId: string; cardId: string } }>> {
  await deps.store.unburyExpired(deps.now());
  const result = await deps.store.undoLastReview(planUndo);
  if (result === 'nothing_to_undo') {
    return fail(404, 'nothing_to_undo');
  }
  return { ok: true, undone: { reviewId: result.log.id, cardId: result.log.cardId } };
}
