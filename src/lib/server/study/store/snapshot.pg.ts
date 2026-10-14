// Contract: one Postgres transaction for the study snapshot. Read-only.
// The batch SQL lives in snapshot-batch.pg.ts so this file stays small.
// Isolation is repeatable read. The mode is read only.
// This read does not take the study advisory lock.
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { DeckSnapshot } from '#lib/server/study/core/queue-choice.js';
import { PG_READ_SNAPSHOT } from '#lib/server/study/store/read-snapshot.pg.js';
import { readPgSnapshotBatch } from '#lib/server/study/store/snapshot-batch.pg.js';
import type { StudySnapshotInput } from '#lib/server/study/store/study-store-types.js';

export async function readPgSnapshots(
  db: PostgresJsDatabase,
  input: StudySnapshotInput,
): Promise<DeckSnapshot[]> {
  return db.transaction((tx) => readPgSnapshotBatch(tx, input), PG_READ_SNAPSHOT);
}
