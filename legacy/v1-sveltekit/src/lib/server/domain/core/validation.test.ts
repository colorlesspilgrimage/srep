import { describe, expect, it } from 'vitest';
import {
  cardsMoveSchema,
  deckCreateSchema,
  deckDeleteSchema,
  noteCreateSchema,
  presetSchema,
} from '#lib/server/domain/core/validation.js';
import { PRESET_INPUT } from '#lib/server/domain/test-support/fixtures.js';

const base = PRESET_INPUT;
const ok = (patch: object) => presetSchema.safeParse({ ...base, ...patch }).success;
const ID = '123e4567-e89b-42d3-a456-426614174000';

describe('presetSchema', () => {
  it('accepts the default preset', () => {
    expect(ok({})).toBe(true);
  });

  it.each([
    [{ desiredRetention: 0.69 }, false],
    [{ desiredRetention: 0.7 }, true],
    [{ desiredRetention: 0.99 }, true],
    [{ desiredRetention: 1.0 }, false],
    [{ newPerDay: -1 }, false],
    [{ newPerDay: 0 }, true],
    [{ newPerDay: 9999 }, true],
    [{ newPerDay: 10000 }, false],
    [{ newPerDay: 1.5 }, false],
    [{ reviewsPerDay: 10000 }, false],
    [{ learningSteps: [] }, true],
    [{ learningSteps: Array(10).fill(1) }, true],
    [{ learningSteps: Array(11).fill(1) }, false],
    [{ learningSteps: [0] }, false],
    [{ relearningSteps: [43_201] }, false],
    [{ maxInterval: 0 }, false],
    [{ maxInterval: 1 }, true],
    [{ maxInterval: 36500 }, true],
    [{ maxInterval: 36501 }, false],
    [{ fsrsParams: null }, true],
    [{ fsrsParams: Array(19).fill(0.5) }, true],
    [{ fsrsParams: Array(21).fill(0.5) }, true],
    [{ fsrsParams: Array(18).fill(0.5) }, false],
    [{ fsrsParams: Array(22).fill(0.5) }, false],
    [{ newOrder: 'random' }, true],
    [{ newOrder: 'other' }, false],
    [{ name: '  ' }, false],
    [{ name: 'a\u0000b' }, false],
    [{ extra: 1 }, false],
  ])('%j gives %s', (patch, expected) => {
    expect(ok(patch)).toBe(expected);
  });

  it('trims the name', () => {
    expect(presetSchema.parse({ ...base, name: '  Fast ' }).name).toBe('Fast');
  });
});

describe('body schemas', () => {
  it('rejects unknown keys and NUL text', () => {
    expect(deckCreateSchema.safeParse({ name: 'x', extra: 1 }).success).toBe(false);
    expect(deckCreateSchema.safeParse({ name: 'a\u0000' }).success).toBe(false);
    expect(deckCreateSchema.safeParse({ name: 'x', parentId: 'nope' }).success).toBe(false);
    const note = { noteTypeId: ID, deckId: ID, fields: ['a\u0000'] };
    expect(noteCreateSchema.safeParse(note).success).toBe(false);
  });

  it('defaults note tags to an empty list', () => {
    const parsed = noteCreateSchema.parse({ noteTypeId: ID, deckId: ID, fields: ['a'] });
    expect(parsed.tags).toEqual([]);
  });

  it('reads both delete actions only', () => {
    expect(deckDeleteSchema.safeParse({ action: 'trash' }).success).toBe(true);
    expect(deckDeleteSchema.safeParse({ action: 'move', targetDeckId: ID }).success).toBe(true);
    expect(deckDeleteSchema.safeParse({ action: 'move' }).success).toBe(false);
    expect(deckDeleteSchema.safeParse({ action: 'trash', targetDeckId: ID }).success).toBe(false);
    expect(deckDeleteSchema.safeParse({ action: 'burn' }).success).toBe(false);
  });

  it('limits a card move to 1 to 500 ids', () => {
    expect(cardsMoveSchema.safeParse({ cardIds: [], deckId: ID }).success).toBe(false);
    expect(cardsMoveSchema.safeParse({ cardIds: Array(500).fill(ID), deckId: ID }).success).toBe(
      true,
    );
    expect(cardsMoveSchema.safeParse({ cardIds: Array(501).fill(ID), deckId: ID }).success).toBe(
      false,
    );
  });
});
