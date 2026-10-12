// Contract: pure plans for an answer and for an undo. The store reads the rows in its
// transaction, calls a plan, and writes the result. No I/O and no clock.
// planAnswer failures: 409 stale_card (reps differ from the client value),
// 409 card_not_studyable (suspended or buried), 422 bad_preset (ts-fsrs refuses the preset).
import { fail, type Failure } from '#lib/server/auth/deps.js';
import type { CardRow, CardState } from '#lib/server/domain/store/store-types.js';
import { answerCard, type SchedulerPreset } from '#lib/server/study/core/fsrs-adapter.js';
import type {
  Rating,
  ReviewLogRow,
  SchedFields,
  SchedState,
  StudyWindow,
} from '#lib/server/study/core/types.js';

export type AnswerPreset = SchedulerPreset & { burySiblings: boolean };

export type AnswerInput = {
  card: CardRow;
  preset: AnswerPreset;
  siblings: CardRow[];
  /** The largest reviewed_at of the whole review log, or null for an empty log. */
  lastReviewedAtMax: number | null;
  rating: Rating;
  expectedReps: number;
  elapsedMs: number;
  nowMs: number;
  window: StudyWindow;
  logId: string;
};

export type AnswerPlan = {
  ok: true;
  cardUpdate: SchedFields & { state: SchedState };
  log: ReviewLogRow;
  /** Siblings to bury. The store buries only those still in state new or review. */
  buryIds: string[];
  buryUntil: number;
};

export type UndoInput = { log: ReviewLogRow; card: CardRow; buried: CardRow[] };

export type UndoPlan = {
  cardRestore: SchedFields & { state: CardState };
  /** Each gets state = sched_state and buried_until = NULL. */
  unburyIds: string[];
};

const BURY_STATES: readonly CardState[] = ['new', 'review'];

export function schedFieldsOf(card: CardRow): SchedFields {
  return {
    schedState: card.schedState,
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    lastReview: card.lastReview,
    reps: card.reps,
    lapses: card.lapses,
    learningStep: card.learningStep,
  };
}

// reviewed_at is strictly increasing over the whole log, so "the latest review" is
// always one row, also when the clock does not move or goes back.
export function planAnswer(input: AnswerInput): AnswerPlan | Failure {
  const { card } = input;
  if (card.reps !== input.expectedReps) {
    return fail(409, 'stale_card');
  }
  if (card.state === 'suspended' || card.state === 'buried') {
    return fail(409, 'card_not_studyable');
  }
  const reviewedAt = Math.max(input.nowMs, (input.lastReviewedAtMax ?? -1) + 1);
  const before = schedFieldsOf(card);
  const result = answerCard(input.preset, before, input.rating, reviewedAt);
  if (result === null) {
    return fail(422, 'bad_preset');
  }
  const buryIds = input.preset.burySiblings
    ? input.siblings
        .filter((s) => s.id !== card.id && s.noteId === card.noteId)
        .filter((s) => BURY_STATES.includes(s.state))
        .map((s) => s.id)
    : [];
  return {
    ok: true,
    cardUpdate: { ...result.fields, state: result.fields.schedState },
    log: {
      id: input.logId,
      cardId: card.id,
      reviewedAt,
      rating: input.rating,
      stateBefore: before.schedState,
      dueBefore: before.due,
      stabilityBefore: before.stability,
      difficultyBefore: before.difficulty,
      lastReviewBefore: before.lastReview,
      repsBefore: before.reps,
      lapsesBefore: before.lapses,
      stepBefore: before.learningStep,
      elapsedMs: input.elapsedMs,
      intervalAfter: result.intervalMinutes,
      buriedSiblingIds: buryIds,
    },
    buryIds,
    buryUntil: input.window.endMs,
  };
}

// A card that the user suspended or buried after the answer keeps that state.
export function planUndo(input: UndoInput): UndoPlan {
  const { log, card } = input;
  const keepState = card.state === 'suspended' || card.state === 'buried';
  const listed = new Set(log.buriedSiblingIds);
  return {
    cardRestore: {
      schedState: log.stateBefore,
      due: log.dueBefore,
      stability: log.stabilityBefore,
      difficulty: log.difficultyBefore,
      lastReview: log.lastReviewBefore,
      reps: log.repsBefore,
      lapses: log.lapsesBefore,
      learningStep: log.stepBefore,
      state: keepState ? card.state : log.stateBefore,
    },
    unburyIds: input.buried
      .filter((s) => listed.has(s.id) && s.state === 'buried')
      .map((s) => s.id),
  };
}
