import {
  checkParameters,
  fsrs,
  generatorParameters,
  State,
  type Card,
  type FSRS,
  type Grade,
  type StepUnit,
} from 'ts-fsrs';
import type { PresetRow } from '#lib/server/domain/store/store-types.js';
import {
  RATINGS,
  type Rating,
  type SchedFields,
  type SchedState,
} from '#lib/server/study/core/types.js';

export type SchedulerPreset = Pick<
  PresetRow,
  'desiredRetention' | 'learningSteps' | 'relearningSteps' | 'maxInterval' | 'fsrsParams'
>;

export type AnswerResult = { fields: SchedFields; intervalMinutes: number };

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

const STATE_BY_NAME: Record<SchedState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

const NAME_BY_STATE: Record<State, SchedState> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
};

function toStepUnits(minutes: number[]): StepUnit[] {
  return minutes.map((m): StepUnit => `${Math.max(1, Math.round(m))}m`);
}

/** Returns null when ts-fsrs refuses the parameters (for example a wrong w length or NaN). */
export function buildFsrs(preset: SchedulerPreset): FSRS | null {
  try {
    if (preset.fsrsParams !== null) {
      checkParameters(preset.fsrsParams);
    }
    return fsrs(
      generatorParameters({
        enable_fuzz: false,
        enable_short_term: true,
        request_retention: preset.desiredRetention,
        maximum_interval: preset.maxInterval,
        learning_steps: toStepUnits(preset.learningSteps),
        relearning_steps: toStepUnits(preset.relearningSteps),
        ...(preset.fsrsParams !== null ? { w: preset.fsrsParams } : {}),
      }),
    );
  } catch {
    return null;
  }
}

/** The start of every replay. due is not compared while reps is 0. */
export function newCardFields(): SchedFields {
  return {
    schedState: 'new',
    due: 0,
    stability: 0,
    difficulty: 0,
    lastReview: null,
    reps: 0,
    lapses: 0,
    learningStep: 0,
  };
}

export function toFsrsCard(fields: SchedFields, elapsedDays = 0, scheduledDays = 0): Card {
  return {
    due: new Date(fields.due),
    stability: fields.stability,
    difficulty: fields.difficulty,
    elapsed_days: elapsedDays,
    scheduled_days: scheduledDays,
    learning_steps: fields.learningStep,
    reps: fields.reps,
    lapses: fields.lapses,
    state: STATE_BY_NAME[fields.schedState],
    ...(fields.lastReview !== null ? { last_review: new Date(fields.lastReview) } : {}),
  };
}

/** Runs one answer on a ts-fsrs card. The due is clamped to maxInterval days. */
export function scheduleFsrsCard(
  scheduler: FSRS,
  maxInterval: number,
  card: Card,
  rating: Rating,
  nowMs: number,
): AnswerResult {
  const next = scheduler.next(card, new Date(nowMs), rating as Grade).card;
  const due = Math.min(next.due.getTime(), nowMs + maxInterval * DAY_MS);
  return {
    fields: {
      schedState: NAME_BY_STATE[next.state],
      due,
      stability: next.stability,
      difficulty: next.difficulty,
      lastReview: next.last_review?.getTime() ?? nowMs,
      reps: next.reps,
      lapses: next.lapses,
      learningStep: next.learning_steps,
    },
    intervalMinutes: Math.round((due - nowMs) / MINUTE_MS),
  };
}

export function answerCard(
  preset: SchedulerPreset,
  fields: SchedFields,
  rating: Rating,
  nowMs: number,
): AnswerResult | null {
  const scheduler = buildFsrs(preset);
  if (scheduler === null) {
    return null;
  }
  return scheduleFsrsCard(scheduler, preset.maxInterval, toFsrsCard(fields), rating, nowMs);
}

export type AnswerPreviews = Record<Rating, { due: number; intervalMinutes: number }>;

/** The same code path as answerCard, so a preview equals the real answer. */
export function previewAnswers(
  preset: SchedulerPreset,
  fields: SchedFields,
  nowMs: number,
): AnswerPreviews | null {
  const previews: Partial<AnswerPreviews> = {};
  for (const rating of RATINGS) {
    const result = answerCard(preset, fields, rating, nowMs);
    if (result === null) {
      return null;
    }
    previews[rating] = { due: result.fields.due, intervalMinutes: result.intervalMinutes };
  }
  return previews as AnswerPreviews;
}
