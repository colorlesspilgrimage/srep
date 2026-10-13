// Contract: the SQLite store for the saved key chords.
// One upsert replaces the whole value. The statement is the transaction (CWE-362, CWE-89).

import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { copyKeybindMap } from '#lib/client/tui/keymap.js';
import { appSettings } from '#lib/server/db/schema/sqlite.js';
import { KEYBIND_SETTINGS_KEY } from '#lib/server/settings/keybind-key.js';
import type { KeybindSettingsStore } from '#lib/server/settings/keybind-store.js';

export function createSqliteKeybindStore(db: BetterSQLite3Database): KeybindSettingsStore {
  return {
    async getKeybindValue() {
      const row = db
        .select({ value: appSettings.value })
        .from(appSettings)
        .where(eq(appSettings.key, KEYBIND_SETTINGS_KEY))
        .get();
      if (row === undefined) {
        return null;
      }
      return row.value;
    },

    async putKeybindValue(value) {
      // Store only the three chords. Extra fields must not stay in the row (CWE-915).
      const stored = copyKeybindMap(value);
      db.insert(appSettings)
        .values({ key: KEYBIND_SETTINGS_KEY, value: stored })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: stored } })
        .run();
    },
  };
}
