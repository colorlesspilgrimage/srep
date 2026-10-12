// Contract: the Postgres part of the StudyStore for card states: suspend, bury and unbury.
// Card state changes lock the card rows with select ... for update, ordered by id, so two
// calls cannot deadlock.
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { card } from '#lib/server/db/schema/pg.js';
import { chunk } from '#lib/server/domain/store/shared.js';
import type { CardRow } from '#lib/server/domain/store/store-types.js';
import type { CardStateUpdate } from '#lib/server/study/core/card-state-plan.js';
import type { StudyCardStateStore } from '#lib/server/study/store/study-store-types.js';

type Exec = Pick<PostgresJsDatabase, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

/** The card rows with the given ids, ordered by id. lock = true adds for update. */
export async function readPgCardsById(tx: Exec, ids: string[], lock: boolean): Promise<CardRow[]> {
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

export function createPgStudyCardStateStore(db: PostgresJsDatabase): StudyCardStateStore {
  return {
    async changeCardStates(cardIds, compute) {
      const ids = [...new Set(cardIds)];
      return db.transaction(async (tx) => {
        const cards = await readPgCardsById(tx, ids, true);
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
  };
}
