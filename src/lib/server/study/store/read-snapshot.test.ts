// Regression: the Postgres study reads ran at read committed. A card row and its log rows
// could then come from two commits, and verify reported a false mismatch.
// No Postgres server is needed: a fake db records the transaction config.
import type { PgTransactionConfig } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { describe, expect, it } from 'vitest';
import { PG_READ_SNAPSHOT } from '#lib/server/study/store/read-snapshot.pg.js';
import { createPgStudyReplayStore } from '#lib/server/study/store/replay-store.pg.js';
import { readPgSnapshots } from '#lib/server/study/store/snapshot.pg.js';

// A query builder whose every step returns itself and which resolves to no rows.
function emptyQuery(): object {
  const query: Record<string, unknown> = {};
  for (const step of ['from', 'where', 'orderBy', 'limit', 'innerJoin', 'groupBy']) {
    query[step] = () => query;
  }
  query.then = (resolve: (rows: unknown[]) => void) => resolve([]);
  return query;
}

function recordingDb(configs: (PgTransactionConfig | undefined)[]): PostgresJsDatabase {
  const tx = { select: () => emptyQuery() };
  const db = {
    transaction: async (run: (t: typeof tx) => Promise<unknown>, config?: PgTransactionConfig) => {
      configs.push(config);
      return run(tx);
    },
  };
  return db as unknown as PostgresJsDatabase;
}

describe('Postgres study reads', () => {
  it('use one repeatable-read, read-only snapshot', async () => {
    expect(PG_READ_SNAPSHOT).toEqual({
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    });
    const configs: (PgTransactionConfig | undefined)[] = [];
    const db = recordingDb(configs);
    expect(await createPgStudyReplayStore(db).readReplayBatch(null, 10)).toEqual([]);
    const window = { dayNumber: 0, startMs: 0, endMs: 1 };
    const input = { deckIds: [], nowMs: 0, window, shuffleDeckIds: [] };
    expect(await readPgSnapshots(db, input)).toEqual([]);
    expect(configs).toEqual([PG_READ_SNAPSHOT, PG_READ_SNAPSHOT]);
  });
});
