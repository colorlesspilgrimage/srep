import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { createPgStudyCardStateStore } from '#lib/server/study/store/card-state-store.pg.js';
import { createPgStudyReplayStore } from '#lib/server/study/store/replay-store.pg.js';
import { createPgStudyReviewStore } from '#lib/server/study/store/review-store.pg.js';
import { createPgStudySettingsStore } from '#lib/server/study/store/settings-store.pg.js';
import { readPgSnapshots } from '#lib/server/study/store/snapshot.pg.js';
import type { StudyStore } from '#lib/server/study/store/study-store-types.js';

export function createPgStudyStore(db: PostgresJsDatabase): StudyStore {
  return {
    readStudySnapshots: async (input) => readPgSnapshots(db, input),
    ...createPgStudyReviewStore(db),
    ...createPgStudyCardStateStore(db),
    ...createPgStudyReplayStore(db),
    ...createPgStudySettingsStore(db),
  };
}
