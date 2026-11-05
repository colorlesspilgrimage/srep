// Contract: the Postgres store for the saved display prefs.
// One upsert replaces the whole value. The statement is the transaction (CWE-362, CWE-89).

import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { DisplayPrefs } from '#lib/client/app/display-prefs.js';
import { appSettings } from '#lib/server/db/schema/pg.js';
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

export function createPgDisplayStore(db: PostgresJsDatabase): DisplaySettingsStore {
  return {
    async getDisplayValue() {
      return readCached(db, 'display', async () => {
        const [row] = await db
          .select({ value: appSettings.value })
          .from(appSettings)
          .where(eq(appSettings.key, DISPLAY_SETTINGS_KEY));
        return row?.value;
      });
    },

    async putDisplayValue(value) {
      const stored = storedPrefs(value);
      await db
        .insert(appSettings)
        .values({ key: DISPLAY_SETTINGS_KEY, value: stored })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: stored } });
      dropCacheSlot(db, 'display');
    },
  };
}
