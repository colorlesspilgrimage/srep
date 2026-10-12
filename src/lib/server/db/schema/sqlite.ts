import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type CardState = 'new' | 'learning' | 'review' | 'relearning' | 'suspended' | 'buried';
/** The scheduling state. card.state equals it unless the card is suspended or buried. */
export type SchedState = 'new' | 'learning' | 'review' | 'relearning';
export type NewOrder = 'added' | 'random';

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull().$type<JsonValue>(),
});

export const authCredential = sqliteTable('auth_credential', {
  id: text('id').primaryKey(),
  credentialId: text('credential_id').notNull().unique(),
  publicKey: text('public_key').notNull(),
  signCount: integer('sign_count').notNull(),
  transports: text('transports', { mode: 'json' }).notNull().$type<string[]>(),
  kind: text('kind').notNull().$type<'passkey' | 'security_key'>(),
  nickname: text('nickname').notNull(),
  createdAt: integer('created_at').notNull(),
  lastUsedAt: integer('last_used_at'),
});

export const authRecovery = sqliteTable('auth_recovery', {
  id: text('id').primaryKey(),
  codeHash: text('code_hash').notNull(),
  usedAt: integer('used_at'),
});

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: integer('created_at').notNull(),
  lastSeenAt: integer('last_seen_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  userAgent: text('user_agent').notNull(),
});

export const authChallenge = sqliteTable('auth_challenge', {
  id: text('id').primaryKey(),
  challenge: text('challenge').notNull(),
  purpose: text('purpose').notNull().$type<'setup' | 'register' | 'login'>(),
  expiresAt: integer('expires_at').notNull(),
});

// Each deck points at one preset. A card has a deck, but card.deck_id is NULL
// only for the cards of a trashed note whose deck was deleted.
export const deckPreset = sqliteTable('deck_preset', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  newPerDay: integer('new_per_day').notNull(),
  reviewsPerDay: integer('reviews_per_day').notNull(),
  desiredRetention: real('desired_retention').notNull(),
  learningSteps: text('learning_steps', { mode: 'json' }).notNull().$type<number[]>(),
  relearningSteps: text('relearning_steps', { mode: 'json' }).notNull().$type<number[]>(),
  maxInterval: integer('max_interval').notNull(),
  fsrsParams: text('fsrs_params', { mode: 'json' }).notNull().$type<number[] | null>(),
  burySiblings: integer('bury_siblings', { mode: 'boolean' }).notNull(),
  newOrder: text('new_order').notNull().$type<NewOrder>(),
});

export const deck = sqliteTable(
  'deck',
  {
    id: text('id').primaryKey(),
    parentId: text('parent_id').references((): AnySQLiteColumn => deck.id),
    name: text('name').notNull(),
    path: text('path').notNull().unique(),
    presetId: text('preset_id')
      .notNull()
      .references(() => deckPreset.id),
    description: text('description').notNull().default(''),
    archivedAt: integer('archived_at'),
  },
  (t) => [index('deck_parent_id_idx').on(t.parentId)],
);

export const noteType = sqliteTable('note_type', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  fields: text('fields', { mode: 'json' }).notNull().$type<string[]>(),
  cssClass: text('css_class').notNull(),
  sortFieldIdx: integer('sort_field_idx').notNull(),
});

export const cardTemplate = sqliteTable(
  'card_template',
  {
    id: text('id').primaryKey(),
    noteTypeId: text('note_type_id')
      .notNull()
      .references(() => noteType.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    ordinal: integer('ordinal').notNull(),
    frontTpl: text('front_tpl').notNull(),
    backTpl: text('back_tpl').notNull(),
  },
  (t) => [uniqueIndex('card_template_note_type_ordinal_idx').on(t.noteTypeId, t.ordinal)],
);

// deleted_at is the trash flag. A note in the trash has a value here.
export const note = sqliteTable(
  'note',
  {
    id: text('id').primaryKey(),
    noteTypeId: text('note_type_id')
      .notNull()
      .references(() => noteType.id),
    guid: text('guid').notNull().unique(),
    fields: text('fields', { mode: 'json' }).notNull().$type<string[]>(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    checksum: text('checksum').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [
    index('note_checksum_idx').on(t.noteTypeId, t.checksum),
    index('note_deleted_at_idx').on(t.deletedAt),
  ],
);

export const noteTag = sqliteTable(
  'note_tag',
  {
    noteId: text('note_id')
      .notNull()
      .references(() => note.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
  },
  (t) => [primaryKey({ columns: [t.noteId, t.tag] }), index('note_tag_tag_idx').on(t.tag)],
);

// ordinal is 0 for a normal template and the cloze index for a cloze template.
// card.deck_id is NULL only for the cards of a trashed note whose deck was deleted.
export const card = sqliteTable(
  'card',
  {
    id: text('id').primaryKey(),
    noteId: text('note_id')
      .notNull()
      .references(() => note.id, { onDelete: 'cascade' }),
    templateId: text('template_id')
      .notNull()
      .references(() => cardTemplate.id),
    ordinal: integer('ordinal').notNull(),
    deckId: text('deck_id').references(() => deck.id, { onDelete: 'set null' }),
    state: text('state').notNull().$type<CardState>(),
    due: integer('due').notNull(),
    stability: real('stability').notNull(),
    difficulty: real('difficulty').notNull(),
    lastReview: integer('last_review'),
    reps: integer('reps').notNull(),
    lapses: integer('lapses').notNull(),
    position: integer('position').notNull(),
    buriedUntil: integer('buried_until'),
    flags: integer('flags').notNull(),
    schedState: text('sched_state').notNull().default('new').$type<SchedState>(),
    learningStep: integer('learning_step').notNull().default(0),
  },
  (t) => [
    uniqueIndex('card_note_template_ordinal_idx').on(t.noteId, t.templateId, t.ordinal),
    index('card_deck_state_due_idx').on(t.deckId, t.state, t.due),
    index('card_note_id_idx').on(t.noteId),
  ],
);

// Written by the study engine. Undo deletes a row. A trash purge cascades to the card's rows.
// The *_before columns hold the card scheduling fields before the answer.
export const reviewLog = sqliteTable(
  'review_log',
  {
    id: text('id').primaryKey(),
    cardId: text('card_id')
      .notNull()
      .references(() => card.id, { onDelete: 'cascade' }),
    reviewedAt: integer('reviewed_at').notNull(),
    rating: integer('rating').notNull(),
    stateBefore: text('state_before').notNull().$type<SchedState>(),
    dueBefore: integer('due_before').notNull(),
    stabilityBefore: real('stability_before').notNull(),
    difficultyBefore: real('difficulty_before').notNull(),
    elapsedMs: integer('elapsed_ms').notNull(),
    intervalAfter: integer('interval_after').notNull(),
    lastReviewBefore: integer('last_review_before'),
    repsBefore: integer('reps_before').notNull().default(0),
    lapsesBefore: integer('lapses_before').notNull().default(0),
    stepBefore: integer('step_before').notNull().default(0),
    buriedSiblingIds: text('buried_sibling_ids', { mode: 'json' })
      .notNull()
      .$type<string[]>()
      .default([]),
  },
  (t) => [
    index('review_log_card_idx').on(t.cardId, t.reviewedAt),
    index('review_log_reviewed_at_idx').on(t.reviewedAt),
  ],
);

export const media = sqliteTable('media', {
  id: text('id').primaryKey(),
  sha256: text('sha256').notNull().unique(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  originalName: text('original_name').notNull(),
});
