// Contract: the SQLite part of the StudyStore for the study settings (app_settings key 'study').
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { appSettings } from '#lib/server/db/schema/sqlite.js';
import type { StudySettingsStore } from '#lib/server/study/store/study-store-types.js';

const STUDY_SETTINGS_KEY = 'study';

export function createSqliteStudySettingsStore(db: BetterSQLite3Database): StudySettingsStore {
  return {
    async getStudySettings() {
      const row = db
        .select({ value: appSettings.value })
        .from(appSettings)
        .where(eq(appSettings.key, STUDY_SETTINGS_KEY))
        .get();
      return row?.value;
    },

    async putStudySettings(value) {
      db.insert(appSettings)
        .values({ key: STUDY_SETTINGS_KEY, value })
        .onConflictDoUpdate({ target: appSettings.key, set: { value } })
        .run();
    },
  };
}
