import { describe, expect, it } from 'vitest';
import {
  answerSchema,
  cardIdsSchema,
  emptyBodySchema,
  studyNextQuerySchema,
  studySettingsSchema,
} from '#lib/server/study/core/validation.js';

const ID = '123e4567-e89b-42d3-a456-426614174000';
const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

describe('study schemas', () => {
  it('accept a valid value', () => {
    expect(ok(studyNextQuerySchema, {})).toBe(true);
    expect(ok(studyNextQuerySchema, { deckId: ID })).toBe(true);
    expect(ok(answerSchema, { cardId: ID, rating: 1, reps: 0, elapsedMs: 0 })).toBe(true);
    expect(ok(answerSchema, { cardId: ID, rating: 4, reps: 1_000_000, elapsedMs: 3_600_000 })).toBe(
      true,
    );
    expect(ok(cardIdsSchema, { cardIds: [ID] })).toBe(true);
    expect(ok(cardIdsSchema, { cardIds: Array(500).fill(ID) })).toBe(true);
    expect(ok(emptyBodySchema, {})).toBe(true);
    expect(ok(studySettingsSchema, { rolloverHour: 0, timezone: 'UTC' })).toBe(true);
    expect(ok(studySettingsSchema, { rolloverHour: 23, timezone: 'Europe/Berlin' })).toBe(true);
  });

  it('refuse unknown keys, bad ids and out-of-range numbers', () => {
    const answer = { cardId: ID, rating: 3, reps: 0, elapsedMs: 0 };
    for (const bad of [
      { ...answer, extra: 1 },
      { ...answer, rating: 0 },
      { ...answer, rating: 5 },
      { ...answer, rating: 2.5 },
      { ...answer, reps: -1 },
      { ...answer, reps: 1_000_001 },
      { ...answer, elapsedMs: -1 },
      { ...answer, elapsedMs: 3_600_001 },
      { ...answer, cardId: 'x' },
      { rating: 3, reps: 0, elapsedMs: 0 },
    ]) {
      expect(ok(answerSchema, bad), JSON.stringify(bad)).toBe(false);
    }
    expect(ok(studyNextQuerySchema, { deckId: 'nope' })).toBe(false);
    expect(ok(studyNextQuerySchema, { other: ID })).toBe(false);
    expect(ok(cardIdsSchema, { cardIds: [] })).toBe(false);
    expect(ok(cardIdsSchema, { cardIds: Array(501).fill(ID) })).toBe(false);
    expect(ok(cardIdsSchema, { cardIds: ['x'] })).toBe(false);
    expect(ok(cardIdsSchema, { cardIds: [ID], more: true })).toBe(false);
    expect(ok(emptyBodySchema, { a: 1 })).toBe(false);
    for (const rolloverHour of [-1, 24, 3.5]) {
      expect(ok(studySettingsSchema, { rolloverHour, timezone: 'UTC' })).toBe(false);
    }
    expect(ok(studySettingsSchema, { rolloverHour: 4, timezone: 'Mars/Base' })).toBe(false);
    expect(ok(studySettingsSchema, { rolloverHour: 4, timezone: 'UTC', x: 1 })).toBe(false);
  });
});
