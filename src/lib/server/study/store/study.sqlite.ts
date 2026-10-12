// Contract: the SQLite StudyStore. better-sqlite3 transactions are synchronous, so each
// transaction runs alone. That is the study lock on SQLite. Callbacks are pure and synchronous.
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
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  appSettings,
  card,
  deck,
  deckPreset,
  note,
  reviewLog,
} from '#lib/server/db/schema/sqlite.js';
import { chunk } from '#lib/server/domain/store/shared.js';
import type { CardRow } from '#lib/server/domain/store/store-types.js';
import type { AnswerPlan } from '#lib/server/study/core/answer-plan.js';
import type { CardStateUpdate } from '#lib/server/study/core/card-state-plan.js';
import type { ReviewLogRow } from '#lib/server/study/core/types.js';
import { readSqliteSnapshots } from '#lib/server/study/store/snapshot.sqlite.js';
import {
  REPLAY_PAGE_SIZE,
  type AnswerContext,
  type CardRebuildUpdate,
  type ReplayBatchItem,
  type StudyStore,
} from '#lib/server/study/store/study-store-types.js';

type Exec = Pick<BetterSQLite3Database, 'select' | 'insert' | 'update' | 'delete'>;

const STUDY_SETTINGS_KEY = 'study';

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

function readCards(tx: Exec, ids: string[]): CardRow[] {
  return chunk(ids).flatMap((part) =>
    tx.select().from(card).where(inArray(card.id, part)).orderBy(asc(card.id)).all(),
  );
}

// Groups the updates by their values, so one statement serves many cards.
function applyStateUpdates(tx: Exec, updates: CardStateUpdate[]): void {
  const groups = new Map<string, CardStateUpdate[]>();
  for (const update of updates) {
    const key = `${update.state}|${update.buriedUntil}`;
    groups.set(key, [...(groups.get(key) ?? []), update]);
  }
  for (const group of groups.values()) {
    const { state, buriedUntil } = group[0] as CardStateUpdate;
    for (const part of chunk(group.map((u) => u.id))) {
      tx.update(card).set({ state, buriedUntil }).where(inArray(card.id, part)).run();
    }
  }
}

function readBatch(tx: Exec, afterCardId: string | null, limit: number): ReplayBatchItem[] {
  const cards = tx
    .select()
    .from(card)
    .where(afterCardId === null ? undefined : gt(card.id, afterCardId))
    .orderBy(asc(card.id))
    .limit(limit)
    .all();
  if (cards.length === 0) {
    return [];
  }
  const logs: ReviewLogRow[] = tx
    .select()
    .from(reviewLog)
    .where(
      inArray(
        reviewLog.cardId,
        cards.map((c) => c.id),
      ),
    )
    .orderBy(asc(reviewLog.reviewedAt), asc(reviewLog.id))
    .all();
  return cards.map((c) => ({ card: c, logs: logs.filter((l) => l.cardId === c.id) }));
}

// state follows sched_state unless the card is suspended or buried.
function applyRebuild(tx: Exec, update: CardRebuildUpdate): void {
  const { fields } = update;
  tx.update(card)
    .set({
      ...fields,
      state: sql`case when ${card.state} in ('suspended', 'buried') then ${card.state} else ${fields.schedState} end`,
    })
    .where(eq(card.id, update.id))
    .run();
}

export function createSqliteStudyStore(db: BetterSQLite3Database): StudyStore {
  return {
    async readStudySnapshots(input) {
      return readSqliteSnapshots(db, input);
    },

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
      return db.transaction((tx) => {
        const log = tx
          .select()
          .from(reviewLog)
          .orderBy(desc(reviewLog.reviewedAt), desc(reviewLog.id))
          .limit(1)
          .get();
        if (log === undefined) {
          return 'nothing_to_undo' as const;
        }
        const row = tx.select().from(card).where(eq(card.id, log.cardId)).get();
        if (row === undefined) {
          throw new Error('review log row without a card');
        }
        const plan = compute({ log, card: row, buried: readCards(tx, log.buriedSiblingIds) });
        tx.update(card).set(plan.cardRestore).where(eq(card.id, row.id)).run();
        unbury(tx, plan.unburyIds);
        tx.delete(reviewLog).where(eq(reviewLog.id, log.id)).run();
        return { ok: true as const, log };
      });
    },

    async changeCardStates(cardIds, compute) {
      const ids = [...new Set(cardIds)];
      return db.transaction((tx) => {
        const cards = readCards(tx, ids);
        if (cards.length !== ids.length) {
          return 'card_not_found' as const;
        }
        const plan = compute(cards);
        if (!plan.ok) {
          return plan;
        }
        applyStateUpdates(tx, plan.updates);
        return { ok: true as const };
      });
    },

    async unburyExpired(nowMs) {
      const result = db
        .update(card)
        .set({ state: sql`${card.schedState}`, buriedUntil: null })
        .where(and(eq(card.state, 'buried'), lte(card.buriedUntil, nowMs)))
        .run();
      return result.changes;
    },

    async readReplayBatch(afterCardId, limit) {
      return db.transaction((tx) => readBatch(tx, afterCardId, limit));
    },

    async rebuildCards(computeBatch) {
      return db.transaction((tx) => {
        let checked = 0;
        let changed = 0;
        let after: string | null = null;
        for (;;) {
          const batch = readBatch(tx, after, REPLAY_PAGE_SIZE);
          for (const update of computeBatch(batch)) {
            applyRebuild(tx, update);
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
      const row = db
        .select({ value: appSettings.value })
        .from(appSettings)
        .where(eq(appSettings.key, STUDY_SETTINGS_KEY))
        .get();
      return row?.value;
    },

    async putStudySettings(value) {
      db.insert(appSettings)
        .values({ key: STUDY_SETTINGS_KEY, value })
        .onConflictDoUpdate({ target: appSettings.key, set: { value } })
        .run();
    },
  };
}
