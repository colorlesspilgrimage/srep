// Contract: the Postgres part of the StudyStore for one card: read, answer and undo.
// Answer and undo take the study lock as the first statement of the transaction.
import { and, asc, desc, eq, getTableColumns, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { card, deck, deckPreset, note, reviewLog } from '#lib/server/db/schema/pg.js';
import { chunk } from '#lib/server/domain/store/shared.js';
import type { AnswerPlan, UndoPlan } from '#lib/server/study/core/answer-plan.js';
import type { ReviewLogRow } from '#lib/server/study/core/types.js';
import { readPgCardsById } from '#lib/server/study/store/card-state-store.pg.js';
import { takeStudyLock } from '#lib/server/study/store/study-lock.pg.js';
import type {
  AnswerContext,
  StudyReviewStore,
  UndoContext,
} from '#lib/server/study/store/study-store-types.js';

type Exec = Pick<PostgresJsDatabase, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

async function readAnswerContext(tx: Exec, cardId: string): Promise<AnswerContext | undefined> {
  const [row] = await tx
    .select(getTableColumns(card))
    .from(card)
    .innerJoin(note, eq(note.id, card.noteId))
    .where(and(eq(card.id, cardId), isNull(note.deletedAt)));
  if (row === undefined || row.deckId === null) {
    return undefined;
  }
  const [preset] = await tx
    .select(getTableColumns(deckPreset))
    .from(deck)
    .innerJoin(deckPreset, eq(deckPreset.id, deck.presetId))
    .where(eq(deck.id, row.deckId));
  if (preset === undefined) {
    return undefined;
  }
  const siblings = await tx
    .select()
    .from(card)
    .where(and(eq(card.noteId, row.noteId), ne(card.id, row.id)))
    .orderBy(asc(card.position));
  const [max] = await tx
    .select({ value: sql<number | null>`max(${reviewLog.reviewedAt})` })
    .from(reviewLog);
  const lastReviewedAtMax =
    max?.value === null || max?.value === undefined ? null : Number(max.value);
  return { card: row, deckPreset: preset, siblings, lastReviewedAtMax };
}

async function applyAnswer(tx: Exec, cardId: string, plan: AnswerPlan): Promise<void> {
  await tx.update(card).set(plan.cardUpdate).where(eq(card.id, cardId));
  await tx.insert(reviewLog).values(plan.log);
  for (const part of chunk(plan.buryIds)) {
    await tx
      .update(card)
      .set({ state: 'buried', buriedUntil: plan.buryUntil })
      .where(and(inArray(card.id, part), inArray(card.state, ['new', 'review'])));
  }
}

async function unbury(tx: Exec, ids: string[]): Promise<void> {
  for (const part of chunk(ids)) {
    await tx
      .update(card)
      .set({ state: sql`${card.schedState}`, buriedUntil: null })
      .where(and(inArray(card.id, part), eq(card.state, 'buried')));
  }
}

// Runs inside the transaction after the study lock. Reverts the newest review and deletes its log row.
async function undoNewestReview(
  tx: Exec,
  compute: (ctx: UndoContext) => UndoPlan,
): Promise<'nothing_to_undo' | { ok: true; log: ReviewLogRow }> {
  const [log] = await tx
    .select()
    .from(reviewLog)
    .orderBy(desc(reviewLog.reviewedAt), desc(reviewLog.id))
    .limit(1);
  if (log === undefined) {
    return 'nothing_to_undo';
  }
  const [row] = await tx.select().from(card).where(eq(card.id, log.cardId));
  if (row === undefined) {
    throw new Error('review log row without a card');
  }
  const buried = await readPgCardsById(tx, log.buriedSiblingIds, false);
  const plan = compute({ log, card: row, buried });
  await tx.update(card).set(plan.cardRestore).where(eq(card.id, row.id));
  await unbury(tx, plan.unburyIds);
  await tx.delete(reviewLog).where(eq(reviewLog.id, log.id));
  return { ok: true, log };
}

export function createPgStudyReviewStore(db: PostgresJsDatabase): StudyReviewStore {
  return {
    async readCard(cardId) {
      const [row] = await db
        .select({ card: getTableColumns(card), deckPreset: getTableColumns(deckPreset) })
        .from(card)
        .leftJoin(deck, eq(deck.id, card.deckId))
        .leftJoin(deckPreset, eq(deckPreset.id, deck.presetId))
        .where(eq(card.id, cardId));
      return row === undefined ? undefined : { card: row.card, deckPreset: row.deckPreset };
    },

    async answerCard(cardId, compute) {
      return db.transaction(async (tx) => {
        await takeStudyLock(tx);
        const ctx = await readAnswerContext(tx, cardId);
        if (ctx === undefined) {
          return 'not_found' as const;
        }
        const plan = compute(ctx);
        if (!plan.ok) {
          return plan;
        }
        await applyAnswer(tx, cardId, plan);
        return { ok: true as const, plan };
      });
    },

    async undoLastReview(compute) {
      return db.transaction(async (tx) => {
        await takeStudyLock(tx);
        return undoNewestReview(tx, compute);
      });
    },
  };
}
