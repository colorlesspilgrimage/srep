// Contract: Postgres batch for every deck in the snapshot.
// Input: a transaction with execute(), plus the snapshot input.
// Output: one DeckSnapshot per deck id, in that order.
// Side effect: none. The caller sets the transaction mode.
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
  pgShuffleKey,
  reviewOrder,
  windowHeadSql,
} from '#lib/server/study/store/snapshot-batch-sql.js';
import { assembleSnapshots, type SqlRow } from '#lib/server/study/store/snapshot-batch-shape.js';

type PgResult = { length: number; [index: number]: SqlRow };

export type PgBatchTx = { execute: (query: SQL) => Promise<PgResult> };

function asRows(value: PgResult): SqlRow[] {
  const out: SqlRow[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const row = value[index];
    if (row !== undefined) {
      out.push(row);
    }
  }
  return out;
}

export async function readPgSnapshotBatch(
  tx: PgBatchTx,
  input: StudySnapshotInput,
): Promise<DeckSnapshot[]> {
  if (input.deckIds.length === 0) {
    return [];
  }
  const decks = input.deckIds;
  const filters = batchFilters(input, pgShuffleKey());
  const done = asRows(await tx.execute(doneSql(filters.ids, input)));
  const learned = asRows(await tx.execute(learningSql(filters.ids, input)));
  const learningHeads = asRows(
    await tx.execute(windowHeadSql(filters.ids, filters.learning, learningOrder())),
  );
  const reviewCounts = asRows(await tx.execute(countSql(filters.ids, filters.review)));
  const reviewHeads = asRows(await tx.execute(headSql(decks, filters.review, reviewOrder())));
  const newCounts = asRows(await tx.execute(countSql(filters.ids, filters.fresh)));
  const newHeads = asRows(await tx.execute(headSql(decks, filters.fresh, filters.shuffle)));
  return assembleSnapshots(input.deckIds, {
    done,
    learning: learned,
    learningHeads,
    reviewCounts,
    reviewHeads,
    newCounts,
    newHeads,
  });
}
