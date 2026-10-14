// Contract: SQLite batch for every deck in the snapshot.
// Input: a transaction with all(), plus the snapshot input.
// Output: one DeckSnapshot per deck id, in that order.
// Side effect: none. The caller owns the transaction.
// An empty deck id list runs no statement.
import type { SQL } from 'drizzle-orm';
import type { DeckSnapshot } from '#lib/server/study/core/queue-choice.js';
import type { StudySnapshotInput } from '#lib/server/study/store/study-store-types.js';
import {
  batchFilters,
  countSql,
  doneSql,
  headSql,
  learningOrder,
  learningSql,
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
  const decks = input.deckIds;
  const filters = batchFilters(input, sqliteShuffleKey());
  return assembleSnapshots(decks, {
    done: tx.all(doneSql(filters.ids, input)),
    learning: tx.all(learningSql(filters.ids, input)),
    learningHeads: tx.all(headSql(decks, filters.learning, learningOrder())),
    reviewCounts: tx.all(countSql(filters.ids, filters.review)),
    reviewHeads: tx.all(headSql(decks, filters.review, reviewOrder())),
    newCounts: tx.all(countSql(filters.ids, filters.fresh)),
    newHeads: tx.all(headSql(decks, filters.fresh, filters.shuffle)),
  });
}
