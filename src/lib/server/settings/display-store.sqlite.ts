// Contract: the SQLite store for the saved display prefs.
// One upsert replaces the whole value. The statement is the transaction (CWE-362, CWE-89).

import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { DisplayPrefs } from '#lib/client/app/display-prefs.js';
import { appSettings } from '#lib/server/db/schema/sqlite.js';
import { dropCacheSlot, readCached } from '#lib/server/read-cache.js';
import { DISPLAY_SETTINGS_KEY } from '#lib/server/settings/display-key.js';
import type { DisplaySettingsStore } from '#lib/server/settings/display-store.js';

function storedPrefs(value: DisplayPrefs): DisplayPrefs {
  // Store only the known fields. Extra fields must not stay in the row (CWE-915).
  return {
    fontSize: value.fontSize,
    reducedMotion: value.reducedMotion,
    scanline: value.scanline,
    cursorBlink: value.cursorBlink,
  };
}

export function createSqliteDisplayStore(db: BetterSQLite3Database): DisplaySettingsStore {
  return {
    async getDisplayValue() {
      return readCached(db, 'display', async () => {
        const row = db
          .select({ value: appSettings.value })
          .from(appSettings)
          .where(eq(appSettings.key, DISPLAY_SETTINGS_KEY))
          .get();
        return row?.value;
      });
    },

    async putDisplayValue(value) {
      const stored = storedPrefs(value);
      db.insert(appSettings)
        .values({ key: DISPLAY_SETTINGS_KEY, value: stored })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: stored } })
        .run();
      dropCacheSlot(db, 'display');
    },
  };
}
