// Contract: the SQLite StudyStore. better-sqlite3 transactions are synchronous, so each
// transaction runs alone. That is the study lock on SQLite. Callbacks are pure and synchronous.
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createSqliteStudyCardStateStore } from '#lib/server/study/store/card-state-store.sqlite.js';
import { createSqliteStudyReplayStore } from '#lib/server/study/store/replay-store.sqlite.js';
import { createSqliteStudyReviewStore } from '#lib/server/study/store/review-store.sqlite.js';
import { createSqliteStudySettingsStore } from '#lib/server/study/store/settings-store.sqlite.js';
import { readSqliteSnapshots } from '#lib/server/study/store/snapshot.sqlite.js';
import type { StudyStore } from '#lib/server/study/store/study-store-types.js';

export function createSqliteStudyStore(db: BetterSQLite3Database): StudyStore {
  return {
    readStudySnapshots: async (input) => readSqliteSnapshots(db, input),
    ...createSqliteStudyReviewStore(db),
    ...createSqliteStudyCardStateStore(db),
    ...createSqliteStudyReplayStore(db),
    ...createSqliteStudySettingsStore(db),
  };
}
