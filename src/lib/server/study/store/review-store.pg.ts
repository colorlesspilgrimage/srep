// Contract: the Postgres part of the StudyStore for one card: read, answer and undo.
// Answer and undo take the study lock as the first statement of the transaction.
import { and, desc, eq, getTableColumns, inArray, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { card, deck, deckPreset, note, reviewLog } from '#lib/server/db/schema/pg.js';
import { chunk } from '#lib/server/domain/store/shared.js';
import type { CardRow, PresetRow } from '#lib/server/domain/store/store-types.js';
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

function num(value: unknown): number {
  return Number(value);
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return Number(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function cardFromJson(value: unknown): CardRow | undefined {
  const row = asRecord(value);
  if (row === undefined || typeof row.id !== 'string') {
    return undefined;
  }
  return {
    id: row.id,
    noteId: String(row.note_id),
    templateId: String(row.template_id),
    ordinal: num(row.ordinal),
    deckId: row.deck_id === null || row.deck_id === undefined ? null : String(row.deck_id),
    state: row.state as CardRow['state'],
    due: num(row.due),
    stability: num(row.stability),
    difficulty: num(row.difficulty),
    lastReview: numOrNull(row.last_review),
    reps: num(row.reps),
    lapses: num(row.lapses),
    position: num(row.position),
    buriedUntil: numOrNull(row.buried_until),
    flags: num(row.flags),
    schedState: row.sched_state as CardRow['schedState'],
    learningStep: num(row.learning_step),
  };
}

function presetFromJson(value: unknown): PresetRow | undefined {
  const row = asRecord(value);
  if (row === undefined || typeof row.id !== 'string') {
    return undefined;
  }
  return {
    id: row.id,
    name: String(row.name),
    newPerDay: num(row.new_per_day),
    reviewsPerDay: num(row.reviews_per_day),
    desiredRetention: num(row.desired_retention),
    learningSteps: Array.isArray(row.learning_steps) ? row.learning_steps.map(num) : [],
    relearningSteps: Array.isArray(row.relearning_steps) ? row.relearning_steps.map(num) : [],
    maxInterval: num(row.max_interval),
    fsrsParams: Array.isArray(row.fsrs_params) ? row.fsrs_params.map(num) : null,
    burySiblings: row.bury_siblings === true,
    newOrder: row.new_order as PresetRow['newOrder'],
  };
}

function siblingRows(value: unknown): CardRow[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: CardRow[] = [];
  for (const item of value) {
    const row = cardFromJson(item);
    if (row !== undefined) {
      out.push(row);
    }
  }
  return out;
}

function answerContextSql(cardId: string): SQL {
  return sql`with locked as (
      select ${card}.* from ${card}
      inner join ${note} on ${note.id} = ${card.noteId}
      where ${card.id} = ${cardId} and ${note.deletedAt} is null
      for update of ${card}
    )
    select
      (select row_to_json(locked) from locked) as card,
      (select row_to_json(${deckPreset}) from ${deck}
        inner join ${deckPreset} on ${deckPreset.id} = ${deck.presetId}
        where ${deck.id} = (select deck_id from locked)) as preset,
      (select coalesce(json_agg(row_to_json(s) order by s.position), '[]'::json)
        from ${card} s
        where s.note_id = (select note_id from locked) and s.id <> ${cardId}) as siblings,
      (select max(${reviewLog.reviewedAt}) from ${reviewLog}) as max_at`;
}

// The card row is read FOR UPDATE: a suspend or bury locks card rows and does not take the
// study lock, so without the row lock this answer could overwrite it (CWE-362).
// One statement reads the card, the preset, the siblings, and the max review time.
async function readAnswerContext(tx: Exec, cardId: string): Promise<AnswerContext | undefined> {
  const result = await tx.execute(answerContextSql(cardId));
  const row = result[0];
  if (row === undefined) {
    return undefined;
  }
  const loaded = cardFromJson(row.card);
  const preset = presetFromJson(row.preset);
  if (loaded === undefined || loaded.deckId === null || preset === undefined) {
    return undefined;
  }
  const maxAt = row.max_at;
  const lastReviewedAtMax = maxAt === null || maxAt === undefined ? null : Number(maxAt);
  return {
    card: loaded,
    deckPreset: preset,
    siblings: siblingRows(row.siblings),
    lastReviewedAtMax,
  };
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
  // FOR UPDATE: see readAnswerContext. The plan keeps a suspend that committed first.
  const [row] = await tx.select().from(card).where(eq(card.id, log.cardId)).for('update');
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
