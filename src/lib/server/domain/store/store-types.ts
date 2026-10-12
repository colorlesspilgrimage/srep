import type { Failure } from '#lib/server/auth/deps.js';
import type { CardState, NewOrder, SchedState } from '#lib/server/db/schema/sqlite.js';

export type { CardState, NewOrder, SchedState };

export type PresetRow = {
  id: string;
  name: string;
  newPerDay: number;
  reviewsPerDay: number;
  desiredRetention: number;
  /** Minutes. */
  learningSteps: number[];
  /** Minutes. */
  relearningSteps: number[];
  maxInterval: number;
  fsrsParams: number[] | null;
  burySiblings: boolean;
  newOrder: NewOrder;
};

export type DeckRow = {
  id: string;
  parentId: string | null;
  name: string;
  path: string;
  presetId: string;
  description: string;
  archivedAt: number | null;
};

export type NoteTypeRow = {
  id: string;
  name: string;
  fields: string[];
  cssClass: string;
  sortFieldIdx: number;
};

export type TemplateRow = {
  id: string;
  noteTypeId: string;
  name: string;
  ordinal: number;
  frontTpl: string;
  backTpl: string;
};

export type NoteTypeWithTemplates = NoteTypeRow & { templates: TemplateRow[] };

export type NoteRow = {
  id: string;
  noteTypeId: string;
  guid: string;
  fields: string[];
  createdAt: number;
  updatedAt: number;
  checksum: string;
  deletedAt: number | null;
};

export type CardRow = {
  id: string;
  noteId: string;
  templateId: string;
  ordinal: number;
  deckId: string | null;
  state: CardState;
  due: number;
  stability: number;
  difficulty: number;
  lastReview: number | null;
  reps: number;
  lapses: number;
  position: number;
  buriedUntil: number | null;
  flags: number;
  /** The scheduling state. It equals state unless the card is suspended or buried. */
  schedState: SchedState;
  /** Index of the current learning or relearning step. */
  learningStep: number;
};

export type MediaRow = {
  id: string;
  sha256: string;
  mime: string;
  size: number;
  originalName: string;
};

/** The store fills the other card columns with the defaults of a new card. */
export type CardDraft = { id: string; templateId: string; ordinal: number; deckId: string };

export type DeckChange = Failure | { ok: true; updates: DeckRow[] };
export type DeckChangeResult = Failure | { ok: true; updates: DeckRow[] };
export type DeckDeleteAction = { kind: 'move'; targetDeckId: string } | { kind: 'trash' };
export type DeckDeleteResult = 'ok' | 'not_found' | 'target_not_found' | 'target_in_subtree';
export type DeckImpact = { decks: number; cards: number; notes: number };

export type NoteState = { note: NoteRow; tags: string[]; cards: CardRow[] };
export type NoteChange =
  | Failure
  | {
      ok: true;
      fields: string[];
      checksum: string;
      updatedAt: number;
      tags: string[];
      create: CardDraft[];
      deleteIds: string[];
      orphanIds: string[];
      unorphanIds: string[];
    };
export type UpdateNoteResult = Failure | { ok: true } | 'not_found';

export type RestoreResult = 'ok' | 'not_found' | 'deck_required' | 'deck_not_found' | 'not_trashed';
export type MoveCardsResult = 'ok' | 'card_not_found' | 'deck_not_found';
export type SeedInput = {
  preset: PresetRow;
  noteTypes: { noteType: NoteTypeRow; templates: TemplateRow[] }[];
};

// Every method is atomic. A "read, decide, write" method takes a pure synchronous
// callback. The callback runs in the transaction after the rows are read.
export interface DomainStore {
  /** Inserts the rows that are absent, in one transaction. It never overwrites. */
  seedDefaults(seed: SeedInput): Promise<void>;

  listPresets(): Promise<PresetRow[]>;
  getPreset(id: string): Promise<PresetRow | undefined>;
  insertPreset(row: PresetRow): Promise<'ok' | 'name_taken'>;
  updatePreset(row: PresetRow): Promise<'ok' | 'not_found' | 'name_taken'>;
  /** in_use: a deck points at the preset. */
  deletePresetUnlessUsed(id: string): Promise<'deleted' | 'not_found' | 'in_use'>;

  /** Ordered by path. */
  listDecks(): Promise<DeckRow[]>;
  getDeck(id: string): Promise<DeckRow | undefined>;
  insertDeck(row: DeckRow): Promise<'ok' | 'name_taken'>;
  /** Applies the updates in one transaction. A path clash gives name_taken and a rollback. */
  changeDecks(compute: (all: DeckRow[]) => DeckChange): Promise<DeckChangeResult>;
  deckImpact(rootId: string): Promise<DeckImpact | undefined>;
  deleteDeckTree(rootId: string, action: DeckDeleteAction, now: number): Promise<DeckDeleteResult>;

  listNoteTypes(): Promise<NoteTypeWithTemplates[]>;
  getNoteType(id: string): Promise<NoteTypeWithTemplates | undefined>;
  insertNoteType(noteType: NoteTypeRow, templates: TemplateRow[]): Promise<'ok' | 'name_taken'>;
  /** in_use: a note (also a trashed note) uses the note type. */
  deleteNoteTypeUnlessUsed(id: string): Promise<'deleted' | 'not_found' | 'in_use'>;

  /** One transaction. The store gives the cards their positions. */
  insertNote(input: {
    note: NoteRow;
    tags: string[];
    cards: CardDraft[];
    now: number;
  }): Promise<void>;
  /** A missing or trashed note gives not_found. */
  updateNote(id: string, compute: (current: NoteState) => NoteChange): Promise<UpdateNoteResult>;
  /** Also returns trashed notes. */
  getNoteState(id: string): Promise<NoteState | undefined>;
  /** Live notes only. */
  findNoteIdsByChecksum(
    noteTypeId: string,
    checksum: string,
    excludeId?: string,
  ): Promise<string[]>;
  trashNote(id: string, now: number): Promise<boolean>;
  restoreNote(id: string, deckId: string | undefined, now: number): Promise<RestoreResult>;
  /** All or nothing. */
  moveCards(cardIds: string[], deckId: string): Promise<MoveCardsResult>;
  /** Deletes trashed notes with deleted_at <= olderThan. Returns the count. */
  purgeTrash(olderThan: number): Promise<number>;

  /** Returns the stored row. On a sha256 clash it returns the existing row. */
  insertMediaIfAbsent(row: MediaRow): Promise<MediaRow>;
  getMediaBySha(sha: string): Promise<MediaRow | undefined>;
  findMissingMedia(shas: string[]): Promise<string[]>;
}
