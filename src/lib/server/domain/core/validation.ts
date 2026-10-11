import { z } from 'zod';

// Postgres text cannot hold U+0000. Every user text is checked (CWE-20).
const noNul = (value: string): boolean => !value.includes('\u0000');

const text = (max: number) => z.string().max(max).refine(noNul);
const name = z.string().trim().min(1).max(100).refine(noNul);

export const MAX_FIELD_TEXT = 50_000;
export const MAX_TEMPLATE_TEXT = 10_000;
export const MAX_CARDS_PER_MOVE = 500;

export const idSchema = z.uuid();

const steps = z.array(z.number().gt(0).max(43_200)).max(10);

export const presetSchema = z
  .object({
    name,
    newPerDay: z.int().min(0).max(9999),
    reviewsPerDay: z.int().min(0).max(9999),
    desiredRetention: z.number().min(0.7).max(0.99),
    learningSteps: steps,
    relearningSteps: steps,
    maxInterval: z.int().min(1).max(36_500),
    fsrsParams: z.array(z.number()).min(19).max(21).nullable(),
    burySiblings: z.boolean(),
    newOrder: z.enum(['added', 'random']),
  })
  .strict();

export type PresetInput = z.output<typeof presetSchema>;

// The deck services check the deck name rules. The schema only bounds the size.
const deckName = text(1000);
const description = text(10_000);

export const deckCreateSchema = z
  .object({
    name: deckName,
    parentId: idSchema.nullable().optional(),
    presetId: idSchema.optional(),
    description: description.optional(),
  })
  .strict();

export type DeckCreateInput = z.output<typeof deckCreateSchema>;

export const deckPatchSchema = z
  .object({
    name: deckName.optional(),
    parentId: idSchema.nullable().optional(),
    presetId: idSchema.optional(),
    description: description.optional(),
  })
  .strict();

export type DeckPatchInput = z.output<typeof deckPatchSchema>;

export const deckDeleteSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('move'), targetDeckId: idSchema }).strict(),
  z.object({ action: z.literal('trash') }).strict(),
]);

export type DeckDeleteInput = z.output<typeof deckDeleteSchema>;

export const noteTypeCreateSchema = z
  .object({
    name,
    cssClass: z.string().max(32).optional(),
    sortFieldIdx: z.int().min(0).max(49).optional(),
    fields: z.array(text(100)).max(100),
    templates: z
      .array(
        z
          .object({
            name: text(200),
            front: text(MAX_TEMPLATE_TEXT),
            back: text(MAX_TEMPLATE_TEXT),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

export type NoteTypeCreateInput = z.output<typeof noteTypeCreateSchema>;

const fields = z.array(text(MAX_FIELD_TEXT)).max(100);
const tags = z.array(text(200)).max(1000);

export const noteCreateSchema = z
  .object({ noteTypeId: idSchema, deckId: idSchema, fields, tags: tags.default([]) })
  .strict();

export type NoteCreateInput = z.output<typeof noteCreateSchema>;

export const notePatchSchema = z
  .object({ fields: fields.optional(), tags: tags.optional(), deckId: idSchema.optional() })
  .strict();

export type NotePatchInput = z.output<typeof notePatchSchema>;

export const noteRestoreSchema = z.object({ deckId: idSchema.optional() }).strict();

export const cardsMoveSchema = z
  .object({ cardIds: z.array(idSchema).min(1).max(MAX_CARDS_PER_MOVE), deckId: idSchema })
  .strict();

export type CardsMoveInput = z.output<typeof cardsMoveSchema>;
