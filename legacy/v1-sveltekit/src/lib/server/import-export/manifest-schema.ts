import { z } from 'zod';
import { NATIVE_MANIFEST_VERSION } from '#lib/server/import-export/types.js';

const presetSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  newPerDay: z.number().int(),
  reviewsPerDay: z.number().int(),
  desiredRetention: z.number(),
  learningSteps: z.array(z.number()),
  relearningSteps: z.array(z.number()),
  maxInterval: z.number().int(),
  fsrsParams: z.array(z.number()).nullable(),
  burySiblings: z.boolean(),
  newOrder: z.enum(['added', 'random']),
});

const deckSchema = z.object({
  id: z.uuid(),
  parentId: z.uuid().nullable(),
  name: z.string(),
  path: z.string(),
  presetId: z.uuid(),
  description: z.string(),
  archivedAt: z.number().int().nullable(),
});

const noteTypeSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  fields: z.array(z.string()),
  cssClass: z.string(),
  sortFieldIdx: z.number().int(),
});

const templateSchema = z.object({
  id: z.uuid(),
  noteTypeId: z.uuid(),
  name: z.string(),
  ordinal: z.number().int(),
  frontTpl: z.string(),
  backTpl: z.string(),
});

const noteSchema = z.object({
  id: z.uuid(),
  noteTypeId: z.uuid(),
  guid: z.string().min(1),
  fields: z.array(z.string()),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  checksum: z.string(),
  deletedAt: z.number().int().nullable(),
});

const cardSchema = z.object({
  id: z.uuid(),
  noteId: z.uuid(),
  templateId: z.uuid(),
  ordinal: z.number().int(),
  deckId: z.uuid().nullable(),
  state: z.enum(['new', 'learning', 'review', 'relearning', 'suspended', 'buried']),
  due: z.number().int(),
  stability: z.number(),
  difficulty: z.number(),
  lastReview: z.number().int().nullable(),
  reps: z.number().int(),
  lapses: z.number().int(),
  position: z.number().int(),
  buriedUntil: z.number().int().nullable(),
  flags: z.number().int(),
  schedState: z.enum(['new', 'learning', 'review', 'relearning']),
  learningStep: z.number().int(),
});

const reviewLogSchema = z.object({
  id: z.uuid(),
  cardId: z.uuid(),
  reviewedAt: z.number().int(),
  rating: z.number().int().min(1).max(4),
  stateBefore: z.enum(['new', 'learning', 'review', 'relearning']),
  dueBefore: z.number().int(),
  stabilityBefore: z.number(),
  difficultyBefore: z.number(),
  lastReviewBefore: z.number().int().nullable(),
  repsBefore: z.number().int(),
  lapsesBefore: z.number().int(),
  stepBefore: z.number().int(),
  elapsedMs: z.number().int(),
  intervalAfter: z.number().int(),
  buriedSiblingIds: z.array(z.uuid()),
});

const mediaSchema = z.object({
  id: z.uuid(),
  sha256: z.string().length(64),
  mime: z.string(),
  size: z.number().int(),
  originalName: z.string(),
});

export const nativeManifestSchema = z.object({
  version: z.literal(NATIVE_MANIFEST_VERSION),
  exportedAt: z.number().int(),
  presets: z.array(presetSchema),
  decks: z.array(deckSchema),
  noteTypes: z.array(z.object({ noteType: noteTypeSchema, templates: z.array(templateSchema) })),
  notes: z.array(noteSchema),
  noteTags: z.array(z.object({ noteId: z.uuid(), tag: z.string().min(1) })),
  cards: z.array(cardSchema),
  reviewLogs: z.array(reviewLogSchema),
  media: z.array(mediaSchema),
  appSettings: z.array(z.object({ key: z.string().min(1), value: z.unknown() })),
});

export type ParsedNativeManifest = z.infer<typeof nativeManifestSchema>;
