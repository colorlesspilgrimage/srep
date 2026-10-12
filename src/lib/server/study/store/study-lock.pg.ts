// Contract: the global study lock on Postgres. Call it as the first statement of a transaction.
// The lock is released at the end of the transaction.
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { STUDY_LOCK_KEY } from '#lib/server/study/store/study-store-types.js';

// The key is a numeric constant, not user input.
export async function takeStudyLock(tx: Pick<PostgresJsDatabase, 'execute'>): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${sql.raw(String(STUDY_LOCK_KEY))})`);
}
