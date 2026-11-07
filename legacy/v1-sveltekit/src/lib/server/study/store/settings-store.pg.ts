import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { createPgAppSettingsSlot } from '#lib/server/settings/app-settings-store.js';
import {
  STUDY_SETTINGS_KEY,
  type StudySettingsStore,
} from '#lib/server/study/store/study-store-types.js';

export function createPgStudySettingsStore(db: PostgresJsDatabase): StudySettingsStore {
  const slot = createPgAppSettingsSlot(db, {
    key: STUDY_SETTINGS_KEY,
    cacheSlot: 'study',
  });
  return {
    getStudySettings: () => slot.getValue(),
    putStudySettings: (value) => slot.putValue(value),
  };
}
