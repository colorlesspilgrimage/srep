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
