import {
  buildFsrs,
  newCardFields,
  scheduleFsrsCard,
  toFsrsCard,
  type SchedulerPreset,
} from '#lib/server/study/core/fsrs-adapter.js';
import {
  RATINGS,
  type Rating,
  type ReviewLogRow,
  type SchedFields,
} from '#lib/server/study/core/types.js';

export type ReplayResult = { fields: SchedFields; chainMismatches: number[] };

const SCHED_FIELD_NAMES: readonly (keyof SchedFields)[] = [
  'schedState',
  'due',
  'stability',
  'difficulty',
  'lastReview',
  'reps',
  'lapses',
  'learningStep',
];

/** Returns the names of the fields that differ. */
export function compareSched(cached: SchedFields, replayed: SchedFields): string[] {
  return SCHED_FIELD_NAMES.filter((name) => {
    if (name === 'due' && cached.reps === 0 && replayed.reps === 0) {
      return false;
    }
    return cached[name] !== replayed[name];
  });
}

function beforeFieldsOf(row: ReviewLogRow): SchedFields {
  return {
    schedState: row.stateBefore,
    due: row.dueBefore,
    stability: row.stabilityBefore,
    difficulty: row.difficultyBefore,
    lastReview: row.lastReviewBefore,
    reps: row.repsBefore,
    lapses: row.lapsesBefore,
    learningStep: row.stepBefore,
  };
}

function isRating(value: number): value is Rating {
  return (RATINGS as readonly number[]).includes(value);
}

export function replayCard(logs: ReviewLogRow[], preset: SchedulerPreset): ReplayResult | null {
  const scheduler = buildFsrs(preset);
  if (scheduler === null) {
    return null;
  }
  const sorted = [...logs].sort((a, b) => a.reviewedAt - b.reviewedAt);
  let fields = newCardFields();
  const chainMismatches: number[] = [];
  for (const [index, row] of sorted.entries()) {
    if (!isRating(row.rating)) {
      chainMismatches.push(index);
      continue;
    }
    if (compareSched(beforeFieldsOf(row), fields).length > 0) {
      chainMismatches.push(index);
    }
    const card = toFsrsCard(fields);
    fields = scheduleFsrsCard(
      scheduler,
      preset.maxInterval,
      card,
      row.rating,
      row.reviewedAt,
    ).fields;
  }
  return { fields, chainMismatches };
}
