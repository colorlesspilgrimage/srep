// Contract: the SQLite store for the saved theme.
// One upsert replaces the whole value. The statement is the transaction (CWE-362, CWE-89).

import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { appSettings } from '#lib/server/db/schema/sqlite.js';
import { THEME_SETTINGS_KEY } from '#lib/server/settings/theme-key.js';
import type { ThemeSettingsStore } from '#lib/server/settings/theme-store.js';

export function createSqliteThemeStore(db: BetterSQLite3Database): ThemeSettingsStore {
  return {
    async getThemeValue() {
      const row = db
        .select({ value: appSettings.value })
        .from(appSettings)
        .where(eq(appSettings.key, THEME_SETTINGS_KEY))
        .get();
      return row?.value;
    },

    async putThemeValue(value) {
      db.insert(appSettings)
        .values({ key: THEME_SETTINGS_KEY, value })
        .onConflictDoUpdate({ target: appSettings.key, set: { value } })
        .run();
    },
  };
}
