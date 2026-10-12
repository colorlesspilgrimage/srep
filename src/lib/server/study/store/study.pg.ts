// Contract: the Postgres StudyStore. Answer, undo and rebuild take the advisory lock
// STUDY_LOCK_KEY as the first statement of the transaction. Card state changes lock the
// card rows with select ... for update, ordered by id (no deadlock between two calls).
// Callbacks are pure and synchronous.
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gt,
  inArray,
  isNull,
  lte,
  ne,
  sql,
} from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { appSettings, card, deck, deckPreset, note, reviewLog } from '#lib/server/db/schema/pg.js';
import { chunk } from '#lib/server/domain/store/shared.js';
import type { CardRow } from '#lib/server/domain/store/store-types.js';
import type { AnswerPlan } from '#lib/server/study/core/answer-plan.js';
import type { CardStateUpdate } from '#lib/server/study/core/card-state-plan.js';
import type { ReviewLogRow } from '#lib/server/study/core/types.js';
import { readPgSnapshots } from '#lib/server/study/store/snapshot.pg.js';
import {
  REPLAY_PAGE_SIZE,
  STUDY_LOCK_KEY,
  type AnswerContext,
  type CardRebuildUpdate,
  type ReplayBatchItem,
  type StudyStore,
} from '#lib/server/study/store/study-store-types.js';

type Exec = Pick<PostgresJsDatabase, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

const STUDY_SETTINGS_KEY = 'study';

// The key is a numeric constant, not user input.
async function takeStudyLock(tx: Exec): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${sql.raw(String(STUDY_LOCK_KEY))})`);
}

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

async function readCards(tx: Exec, ids: string[], lock: boolean): Promise<CardRow[]> {
  const out: CardRow[] = [];
  for (const part of chunk([...ids].sort())) {
    const query = tx.select().from(card).where(inArray(card.id, part)).orderBy(asc(card.id));
    out.push(...(lock ? await query.for('update') : await query));
  }
  return out;
}

// Groups the updates by their values, so one statement serves many cards.
async function applyStateUpdates(tx: Exec, updates: CardStateUpdate[]): Promise<void> {
  const groups = new Map<string, CardStateUpdate[]>();
  for (const update of updates) {
    const key = `${update.state}|${update.buriedUntil}`;
    groups.set(key, [...(groups.get(key) ?? []), update]);
  }
  for (const group of groups.values()) {
    const { state, buriedUntil } = group[0] as CardStateUpdate;
    for (const part of chunk(group.map((u) => u.id))) {
      await tx.update(card).set({ state, buriedUntil }).where(inArray(card.id, part));
    }
  }
}

async function readBatch(
  tx: Exec,
  afterCardId: string | null,
  limit: number,
): Promise<ReplayBatchItem[]> {
  const cards = await tx
    .select()
    .from(card)
    .where(afterCardId === null ? undefined : gt(card.id, afterCardId))
    .orderBy(asc(card.id))
    .limit(limit);
  if (cards.length === 0) {
    return [];
  }
  const logs: ReviewLogRow[] = await tx
    .select()
    .from(reviewLog)
    .where(
      inArray(
        reviewLog.cardId,
        cards.map((c) => c.id),
      ),
    )
    .orderBy(asc(reviewLog.reviewedAt), asc(reviewLog.id));
  return cards.map((c) => ({ card: c, logs: logs.filter((l) => l.cardId === c.id) }));
}

// state follows sched_state unless the card is suspended or buried.
async function applyRebuild(tx: Exec, update: CardRebuildUpdate): Promise<void> {
  const { fields } = update;
  await tx
    .update(card)
    .set({
      ...fields,
      state: sql`case when ${card.state} in ('suspended', 'buried') then ${card.state} else ${fields.schedState} end`,
    })
    .where(eq(card.id, update.id));
}

export function createPgStudyStore(db: PostgresJsDatabase): StudyStore {
  return {
    async readStudySnapshots(input) {
      return readPgSnapshots(db, input);
    },

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
        const [log] = await tx
          .select()
          .from(reviewLog)
          .orderBy(desc(reviewLog.reviewedAt), desc(reviewLog.id))
          .limit(1);
        if (log === undefined) {
          return 'nothing_to_undo' as const;
        }
        const [row] = await tx.select().from(card).where(eq(card.id, log.cardId));
        if (row === undefined) {
          throw new Error('review log row without a card');
        }
        const buried = await readCards(tx, log.buriedSiblingIds, false);
        const plan = compute({ log, card: row, buried });
        await tx.update(card).set(plan.cardRestore).where(eq(card.id, row.id));
        await unbury(tx, plan.unburyIds);
        await tx.delete(reviewLog).where(eq(reviewLog.id, log.id));
        return { ok: true as const, log };
      });
    },

    async changeCardStates(cardIds, compute) {
      const ids = [...new Set(cardIds)];
      return db.transaction(async (tx) => {
        const cards = await readCards(tx, ids, true);
        if (cards.length !== ids.length) {
          return 'card_not_found' as const;
        }
        const plan = compute(cards);
        if (!plan.ok) {
          return plan;
        }
        await applyStateUpdates(tx, plan.updates);
        return { ok: true as const };
      });
    },

    async unburyExpired(nowMs) {
      const rows = await db
        .update(card)
        .set({ state: sql`${card.schedState}`, buriedUntil: null })
        .where(and(eq(card.state, 'buried'), lte(card.buriedUntil, nowMs)))
        .returning({ id: card.id });
      return rows.length;
    },

    async readReplayBatch(afterCardId, limit) {
      return db.transaction(async (tx) => readBatch(tx, afterCardId, limit));
    },

    async rebuildCards(computeBatch) {
      return db.transaction(async (tx) => {
        await takeStudyLock(tx);
        let checked = 0;
        let changed = 0;
        let after: string | null = null;
        for (;;) {
          const batch = await readBatch(tx, after, REPLAY_PAGE_SIZE);
          for (const update of computeBatch(batch)) {
            await applyRebuild(tx, update);
            changed += 1;
          }
          checked += batch.length;
          if (batch.length < REPLAY_PAGE_SIZE) {
            return { checked, changed };
          }
          after = (batch.at(-1) as ReplayBatchItem).card.id;
        }
      });
    },

    async getStudySettings() {
      const [row] = await db
        .select({ value: appSettings.value })
        .from(appSettings)
        .where(eq(appSettings.key, STUDY_SETTINGS_KEY));
      return row?.value;
    },

    async putStudySettings(value) {
      await db
        .insert(appSettings)
        .values({ key: STUDY_SETTINGS_KEY, value })
        .onConflictDoUpdate({ target: appSettings.key, set: { value } });
    },
  };
}
