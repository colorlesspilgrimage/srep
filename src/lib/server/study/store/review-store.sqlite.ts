// Contract: the SQLite part of the StudyStore for one card: read, answer and undo.
// A synchronous better-sqlite3 transaction runs alone, so it is the study lock on SQLite.
import { and, asc, desc, eq, getTableColumns, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { card, deck, deckPreset, note, reviewLog } from '#lib/server/db/schema/sqlite.js';
import { chunk } from '#lib/server/domain/store/shared.js';
import type { AnswerPlan, UndoPlan } from '#lib/server/study/core/answer-plan.js';
import type { ReviewLogRow } from '#lib/server/study/core/types.js';
import { readSqliteCardsById } from '#lib/server/study/store/card-state-store.sqlite.js';
import type {
  AnswerContext,
  StudyReviewStore,
  UndoContext,
} from '#lib/server/study/store/study-store-types.js';

type Exec = Pick<BetterSQLite3Database, 'select' | 'insert' | 'update' | 'delete'>;

function readAnswerContext(tx: Exec, cardId: string): AnswerContext | undefined {
  const row = tx
    .select(getTableColumns(card))
    .from(card)
    .innerJoin(note, eq(note.id, card.noteId))
    .where(and(eq(card.id, cardId), isNull(note.deletedAt)))
    .get();
  if (row === undefined || row.deckId === null) {
    return undefined;
  }
  const preset = tx
    .select(getTableColumns(deckPreset))
    .from(deck)
    .innerJoin(deckPreset, eq(deckPreset.id, deck.presetId))
    .where(eq(deck.id, row.deckId))
    .get();
  if (preset === undefined) {
    return undefined;
  }
  const siblings = tx
    .select()
    .from(card)
    .where(and(eq(card.noteId, row.noteId), ne(card.id, row.id)))
    .orderBy(asc(card.position))
    .all();
  const max = tx
    .select({ value: sql<number | null>`max(${reviewLog.reviewedAt})` })
    .from(reviewLog)
    .get();
  const lastReviewedAtMax =
    max?.value === null || max?.value === undefined ? null : Number(max.value);
  return { card: row, deckPreset: preset, siblings, lastReviewedAtMax };
}

function applyAnswer(tx: Exec, cardId: string, plan: AnswerPlan): void {
  tx.update(card).set(plan.cardUpdate).where(eq(card.id, cardId)).run();
  tx.insert(reviewLog).values(plan.log).run();
  for (const part of chunk(plan.buryIds)) {
    tx.update(card)
      .set({ state: 'buried', buriedUntil: plan.buryUntil })
      .where(and(inArray(card.id, part), inArray(card.state, ['new', 'review'])))
      .run();
  }
}

function unbury(tx: Exec, ids: string[]): void {
  for (const part of chunk(ids)) {
    tx.update(card)
      .set({ state: sql`${card.schedState}`, buriedUntil: null })
      .where(and(inArray(card.id, part), eq(card.state, 'buried')))
      .run();
  }
}

// Runs inside the transaction. Reverts the newest review and deletes its log row.
function undoNewestReview(
  tx: Exec,
  compute: (ctx: UndoContext) => UndoPlan,
): 'nothing_to_undo' | { ok: true; log: ReviewLogRow } {
  const log = tx
    .select()
    .from(reviewLog)
    .orderBy(desc(reviewLog.reviewedAt), desc(reviewLog.id))
    .limit(1)
    .get();
  if (log === undefined) {
    return 'nothing_to_undo';
  }
  const row = tx.select().from(card).where(eq(card.id, log.cardId)).get();
  if (row === undefined) {
    throw new Error('review log row without a card');
  }
  const plan = compute({ log, card: row, buried: readSqliteCardsById(tx, log.buriedSiblingIds) });
  tx.update(card).set(plan.cardRestore).where(eq(card.id, row.id)).run();
  unbury(tx, plan.unburyIds);
  tx.delete(reviewLog).where(eq(reviewLog.id, log.id)).run();
  return { ok: true, log };
}

export function createSqliteStudyReviewStore(db: BetterSQLite3Database): StudyReviewStore {
  return {
    async readCard(cardId) {
      const row = db
        .select({ card: getTableColumns(card), deckPreset: getTableColumns(deckPreset) })
        .from(card)
        .leftJoin(deck, eq(deck.id, card.deckId))
        .leftJoin(deckPreset, eq(deckPreset.id, deck.presetId))
        .where(eq(card.id, cardId))
        .get();
      return row === undefined ? undefined : { card: row.card, deckPreset: row.deckPreset };
    },

    async answerCard(cardId, compute) {
      return db.transaction((tx) => {
        const ctx = readAnswerContext(tx, cardId);
        if (ctx === undefined) {
          return 'not_found' as const;
        }
        const plan = compute(ctx);
        if (!plan.ok) {
          return plan;
        }
        applyAnswer(tx, cardId, plan);
        return { ok: true as const, plan };
      });
    },

    async undoLastReview(compute) {
      return db.transaction((tx) => undoNewestReview(tx, compute));
    },
  };
}
