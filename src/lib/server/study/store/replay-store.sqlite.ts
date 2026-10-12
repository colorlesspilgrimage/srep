// Contract: the SQLite part of the StudyStore for replay: verify batches and rebuild.
// The rebuild runs in one synchronous transaction, which is the study lock on SQLite.
import { asc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { card, reviewLog } from '#lib/server/db/schema/sqlite.js';
import type { ReviewLogRow } from '#lib/server/study/core/types.js';
import {
  REPLAY_PAGE_SIZE,
  type CardRebuildUpdate,
  type ReplayBatchItem,
  type StudyReplayStore,
} from '#lib/server/study/store/study-store-types.js';

type Exec = Pick<BetterSQLite3Database, 'select' | 'insert' | 'update' | 'delete'>;

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

export function createSqliteStudyReplayStore(db: BetterSQLite3Database): StudyReplayStore {
  return {
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
  };
}
