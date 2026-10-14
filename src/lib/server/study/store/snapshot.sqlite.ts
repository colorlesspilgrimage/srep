// Contract: one SQLite transaction for the study snapshot. Read-only.
// The batch SQL lives in snapshot-batch.sqlite.ts so this file stays small.
// An empty deck list still uses one transaction and returns no rows.
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { DeckSnapshot } from '#lib/server/study/core/queue-choice.js';
import { readSqliteSnapshotBatch } from '#lib/server/study/store/snapshot-batch.sqlite.js';
import type { StudySnapshotInput } from '#lib/server/study/store/study-store-types.js';

export function readSqliteSnapshots(
  db: BetterSQLite3Database,
  input: StudySnapshotInput,
): DeckSnapshot[] {
  return db.transaction((tx) => readSqliteSnapshotBatch(tx, input));
}
