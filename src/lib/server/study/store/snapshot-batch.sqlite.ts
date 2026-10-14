// Contract: SQLite batch for every deck in the snapshot.
// Input: a transaction with all(), plus the snapshot input.
// Output: one DeckSnapshot per deck id, in that order.
// Side effect: none. The caller owns the transaction.
// An empty deck id list runs no statement.
import type { SQL } from 'drizzle-orm';
import type { DeckSnapshot } from '#lib/server/study/core/queue-choice.js';
import type { StudySnapshotInput } from '#lib/server/study/store/study-store-types.js';
import {
  countSql,
  doneSql,
  freshFilter,
  headSql,
  idList,
  learningFilter,
  learningOrder,
  learningSql,
  newOrder,
  reviewFilter,
  reviewOrder,
  sqliteShuffleKey,
} from '#lib/server/study/store/snapshot-batch-sql.js';
import { assembleSnapshots, type SqlRow } from '#lib/server/study/store/snapshot-batch-shape.js';

export type SqliteBatchTx = { all: (query: SQL) => SqlRow[] };

export function readSqliteSnapshotBatch(
  tx: SqliteBatchTx,
  input: StudySnapshotInput,
): DeckSnapshot[] {
  if (input.deckIds.length === 0) {
    return [];
  }
  const ids = idList(input.deckIds);
  const fresh = freshFilter();
  const review = reviewFilter(input.window.endMs);
  const learning = learningFilter(input.nowMs);
  const shuffle = newOrder(input.shuffleDeckIds, sqliteShuffleKey());
  return assembleSnapshots(input.deckIds, {
    done: tx.all(doneSql(ids, input)),
    learning: tx.all(learningSql(ids, input)),
    learningHeads: tx.all(headSql(ids, learning, learningOrder())),
    reviewCounts: tx.all(countSql(ids, review)),
    reviewHeads: tx.all(headSql(ids, review, reviewOrder())),
    newCounts: tx.all(countSql(ids, fresh)),
    newHeads: tx.all(headSql(ids, fresh, shuffle)),
  });
}
