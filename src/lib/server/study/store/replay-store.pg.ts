// Contract: the Postgres part of the StudyStore for replay: verify batches and rebuild.
// The rebuild takes the study lock as the first statement of its transaction.
import { asc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { card, reviewLog } from '#lib/server/db/schema/pg.js';
import type { ReviewLogRow } from '#lib/server/study/core/types.js';
import { PG_READ_SNAPSHOT } from '#lib/server/study/store/read-snapshot.pg.js';
import { takeStudyLock } from '#lib/server/study/store/study-lock.pg.js';
import {
  REPLAY_PAGE_SIZE,
  type CardRebuildUpdate,
  type ReplayBatchItem,
  type StudyReplayStore,
} from '#lib/server/study/store/study-store-types.js';

type Exec = Pick<PostgresJsDatabase, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

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

export function createPgStudyReplayStore(db: PostgresJsDatabase): StudyReplayStore {
  return {
    // A card row and its log rows come from one snapshot, so a concurrent answer cannot
    // show up as a false mismatch in verify.
    async readReplayBatch(afterCardId, limit) {
      return db.transaction(async (tx) => readBatch(tx, afterCardId, limit), PG_READ_SNAPSHOT);
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
  };
}
