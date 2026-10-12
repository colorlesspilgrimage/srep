// Contract: the Postgres part of the StudyStore for the study settings (app_settings key 'study').
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { appSettings } from '#lib/server/db/schema/pg.js';
import type { StudySettingsStore } from '#lib/server/study/store/study-store-types.js';

const STUDY_SETTINGS_KEY = 'study';

export function createPgStudySettingsStore(db: PostgresJsDatabase): StudySettingsStore {
  return {
    async getStudySettings() {
      const [row] = await db
        .select({ value: appSettings.value })
        .from(appSettings)
        .where(eq(appSettings.key, STUDY_SETTINGS_KEY));
      return row?.value;
    },

    async putStudySettings(value) {
      await db
        .insert(appSettings)
        .values({ key: STUDY_SETTINGS_KEY, value })
        .onConflictDoUpdate({ target: appSettings.key, set: { value } });
    },
  };
}
