import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createSqliteAppSettingsSlot } from '#lib/server/settings/app-settings-store.js';
import {
  STUDY_SETTINGS_KEY,
  type StudySettingsStore,
} from '#lib/server/study/store/study-store-types.js';

export function createSqliteStudySettingsStore(db: BetterSQLite3Database): StudySettingsStore {
  const slot = createSqliteAppSettingsSlot(db, {
    key: STUDY_SETTINGS_KEY,
    cacheSlot: 'study',
  });
  return {
    getStudySettings: () => slot.getValue(),
    putStudySettings: (value) => slot.putValue(value),
  };
}
