import type { DbHandle } from '#lib/server/db/client.js';
import { createPgStudyStore } from '#lib/server/study/store/study.pg.js';
import { createSqliteStudyStore } from '#lib/server/study/store/study.sqlite.js';
import type { StudyStore } from '#lib/server/study/store/study-store-types.js';

export function getStudyStore(handle: DbHandle): StudyStore {
  return handle.dialect === 'sqlite'
    ? createSqliteStudyStore(handle.db)
    : createPgStudyStore(handle.db);
}
