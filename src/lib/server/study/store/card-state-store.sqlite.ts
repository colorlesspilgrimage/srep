// Contract: the SQLite part of the StudyStore for card states: suspend, bury and unbury.
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { card } from '#lib/server/db/schema/sqlite.js';
import { chunk } from '#lib/server/domain/store/shared.js';
import type { CardRow } from '#lib/server/domain/store/store-types.js';
import type { CardStateUpdate } from '#lib/server/study/core/card-state-plan.js';
import type { StudyCardStateStore } from '#lib/server/study/store/study-store-types.js';

type Exec = Pick<BetterSQLite3Database, 'select' | 'insert' | 'update' | 'delete'>;

/** The card rows with the given ids, ordered by id. Unknown ids are left out. */
export function readSqliteCardsById(tx: Exec, ids: string[]): CardRow[] {
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

export function createSqliteStudyCardStateStore(db: BetterSQLite3Database): StudyCardStateStore {
  return {
    async changeCardStates(cardIds, compute) {
      const ids = [...new Set(cardIds)];
      return db.transaction((tx) => {
        const cards = readSqliteCardsById(tx, ids);
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
  };
}
