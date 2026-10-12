// Contract: the study repository. Every method is atomic. A "read, decide, write" method
// takes a pure synchronous callback that runs inside the transaction after the read.
// Answer, undo and rebuild take one global study lock (SQLite: the synchronous
// transaction; Postgres: pg_advisory_xact_lock(STUDY_LOCK_KEY)). Card state changes lock
// the card rows (Postgres: select ... for update, ordered by id).
import type { Failure } from '#lib/server/auth/deps.js';
import type { CardRow, PresetRow } from '#lib/server/domain/store/store-types.js';
import type { AnswerPlan, UndoPlan } from '#lib/server/study/core/answer-plan.js';
import type { CardStateUpdate } from '#lib/server/study/core/card-state-plan.js';
import type { DeckSnapshot } from '#lib/server/study/core/queue-choice.js';
import type {
  ReviewLogRow,
  SchedFields,
  StudySettings,
  StudyWindow,
} from '#lib/server/study/core/types.js';

/** The key of the Postgres advisory lock for study writes. A constant, never user input. */
export const STUDY_LOCK_KEY = 7_303_301;

/** The page size of verify and rebuild (CWE-770). */
export const REPLAY_PAGE_SIZE = 500;

export type StudySnapshotInput = {
  deckIds: string[];
  nowMs: number;
  window: StudyWindow;
  /** Decks with newOrder 'random'. Their new head uses the shuffle key. */
  shuffleDeckIds: string[];
};

export type AnswerContext = {
  card: CardRow;
  /** The preset of the card's own deck. */
  deckPreset: PresetRow;
  /** The other cards of the same note. */
  siblings: CardRow[];
  /** The largest reviewed_at of the whole log, or null for an empty log. */
  lastReviewedAtMax: number | null;
};

export type UndoContext = { log: ReviewLogRow; card: CardRow; buried: CardRow[] };

export type ReplayBatchItem = { card: CardRow; logs: ReviewLogRow[] };

/** The replayed scheduling fields of a card whose cache differs from the replay. */
export type CardRebuildUpdate = { id: string; fields: SchedFields };

export type AnswerCardResult = Failure | { ok: true; plan: AnswerPlan } | 'not_found';
export type ChangeCardStatesResult = Failure | { ok: true } | 'card_not_found';

export interface StudyStore {
  /** One entry per deck id, in the same order. Read-only. Cards of trashed notes are left out. */
  readStudySnapshots(input: StudySnapshotInput): Promise<DeckSnapshot[]>;

  /** One card row with the preset of its deck. undefined for an unknown card. */
  readCard(cardId: string): Promise<{ card: CardRow; deckPreset: PresetRow | null } | undefined>;

  /** not_found: no card, the note is in the trash, or the card has no deck. */
  answerCard(
    cardId: string,
    compute: (ctx: AnswerContext) => AnswerPlan | Failure,
  ): Promise<AnswerCardResult>;

  /** Reverts the review with the largest reviewed_at and deletes its log row. */
  undoLastReview(
    compute: (ctx: UndoContext) => UndoPlan,
  ): Promise<'nothing_to_undo' | { ok: true; log: ReviewLogRow }>;

  /** All or nothing. A missing id gives card_not_found and writes nothing. */
  changeCardStates(
    cardIds: string[],
    compute: (cards: CardRow[]) => Failure | { ok: true; updates: CardStateUpdate[] },
  ): Promise<ChangeCardStatesResult>;

  /** Sets state = sched_state for buried cards with buried_until <= nowMs. Returns the count. */
  unburyExpired(nowMs: number): Promise<number>;

  /** Cards with id > afterCardId, ordered by id. Logs ordered by reviewed_at. */
  readReplayBatch(afterCardId: string | null, limit: number): Promise<ReplayBatchItem[]>;

  /**
   * One transaction under the study lock. Pages through all cards. Writes the scheduling
   * columns of the returned updates, and state too when the card is not suspended or buried.
   */
  rebuildCards(
    computeBatch: (batch: ReplayBatchItem[]) => CardRebuildUpdate[],
  ): Promise<{ checked: number; changed: number }>;

  /** The raw value of app_settings key 'study', or undefined. */
  getStudySettings(): Promise<unknown>;
  /** Upsert of app_settings key 'study'. */
  putStudySettings(value: StudySettings): Promise<void>;
}

/** The parts of the StudyStore. Each dialect builds one factory per part (*-store.<dialect>.ts). */
export type StudyReviewStore = Pick<StudyStore, 'readCard' | 'answerCard' | 'undoLastReview'>;
export type StudyCardStateStore = Pick<StudyStore, 'changeCardStates' | 'unburyExpired'>;
export type StudyReplayStore = Pick<StudyStore, 'readReplayBatch' | 'rebuildCards'>;
export type StudySettingsStore = Pick<StudyStore, 'getStudySettings' | 'putStudySettings'>;
