import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { STUDY_LOCK_KEY } from '#lib/server/study/store/study-store-types.js';

export async function takeStudyLock(tx: Pick<PostgresJsDatabase, 'execute'>): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${sql.raw(String(STUDY_LOCK_KEY))})`);
}
