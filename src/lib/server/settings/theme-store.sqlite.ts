// Contract: the SQLite store for the saved theme.
// One upsert replaces the whole value. The statement is the transaction (CWE-362, CWE-89).

import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { appSettings } from '#lib/server/db/schema/sqlite.js';
import { dropCacheSlot, readCached } from '#lib/server/read-cache.js';
import { THEME_SETTINGS_KEY } from '#lib/server/settings/theme-key.js';
import type { ThemeSettingsStore } from '#lib/server/settings/theme-store.js';

export function createSqliteThemeStore(db: BetterSQLite3Database): ThemeSettingsStore {
  return {
    async getThemeValue() {
      return readCached(db, 'theme', async () => {
        const row = db
          .select({ value: appSettings.value })
          .from(appSettings)
          .where(eq(appSettings.key, THEME_SETTINGS_KEY))
          .get();
        return row?.value;
      });
    },

    async putThemeValue(value) {
      // Store only the id. Extra fields must not stay in the row (CWE-915).
      const stored = { id: value.id };
      db.insert(appSettings)
        .values({ key: THEME_SETTINGS_KEY, value: stored })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: stored } })
        .run();
      dropCacheSlot(db, 'theme');
    },
  };
}
