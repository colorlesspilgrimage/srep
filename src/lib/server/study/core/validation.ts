// Contract: zod schemas for every study input. All objects are strict (CWE-20).
// Ids are UUIDs. Numbers are integers with bounds.
import { z } from 'zod';
import { idSchema, MAX_CARDS_PER_MOVE } from '#lib/server/domain/core/validation.js';
import { isValidTimezone } from '#lib/server/study/core/day-clock.js';

export const MAX_ELAPSED_MS = 3_600_000;
export const MAX_REPS = 1_000_000;

export const studyNextQuerySchema = z.object({ deckId: idSchema.optional() }).strict();

export const answerSchema = z
  .object({
    cardId: idSchema,
    rating: z.int().min(1).max(4),
    reps: z.int().min(0).max(MAX_REPS),
    elapsedMs: z.int().min(0).max(MAX_ELAPSED_MS),
  })
  .strict();

export type AnswerBody = z.output<typeof answerSchema>;

export const cardIdsSchema = z
  .object({ cardIds: z.array(idSchema).min(1).max(MAX_CARDS_PER_MOVE) })
  .strict();

export const emptyBodySchema = z.object({}).strict();

export const studySettingsSchema = z
  .object({
    rolloverHour: z.int().min(0).max(23),
    timezone: z.string().refine(isValidTimezone),
  })
  .strict();
