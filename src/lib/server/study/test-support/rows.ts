// Row factories for the pure study tests.
import { BASIC_CARD_ID, BUILTIN_PRESET } from '#lib/server/domain/builtin.js';
import type { CardRow } from '#lib/server/domain/store/store-types.js';
import type { AnswerPreset } from '#lib/server/study/core/answer-plan.js';

export const TEST_PRESET: AnswerPreset = { ...BUILTIN_PRESET, burySiblings: false };

/** A new card of note 'n1' in deck 'd1'. */
export function cardRow(id: string, patch: Partial<CardRow> = {}): CardRow {
  return {
    id,
    noteId: 'n1',
    templateId: BASIC_CARD_ID,
    ordinal: 0,
    deckId: 'd1',
    state: 'new',
    due: 500,
    stability: 0,
    difficulty: 0,
    lastReview: null,
    reps: 0,
    lapses: 0,
    position: 0,
    buriedUntil: null,
    flags: 0,
    schedState: 'new',
    learningStep: 0,
    ...patch,
  };
}
