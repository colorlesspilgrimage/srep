// Contract: the Postgres store for the saved key chords.
// One upsert replaces the whole value. The statement is the transaction (CWE-362, CWE-89).

import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  PALETTE_CLOSE,
  PALETTE_OPEN,
  PALETTE_OPEN_COLON,
  type KeybindMap,
} from '#lib/client/tui/keymap.js';
import { appSettings } from '#lib/server/db/schema/pg.js';
import { KEYBIND_SETTINGS_KEY } from '#lib/server/settings/keybind-key.js';
import type { KeybindSettingsStore } from '#lib/server/settings/keybind-store.js';

function storedMap(value: KeybindMap): KeybindMap {
  return {
    [PALETTE_OPEN]: value[PALETTE_OPEN],
    [PALETTE_OPEN_COLON]: value[PALETTE_OPEN_COLON],
    [PALETTE_CLOSE]: value[PALETTE_CLOSE],
  };
}

export function createPgKeybindStore(db: PostgresJsDatabase): KeybindSettingsStore {
  return {
    async getKeybindValue() {
      const [row] = await db
        .select({ value: appSettings.value })
        .from(appSettings)
        .where(eq(appSettings.key, KEYBIND_SETTINGS_KEY));
      if (row === undefined) {
        return null;
      }
      return row.value;
    },

    async putKeybindValue(value) {
      // Store only the three chords. Extra fields must not stay in the row (CWE-915).
      const stored = storedMap(value);
      await db
        .insert(appSettings)
        .values({ key: KEYBIND_SETTINGS_KEY, value: stored })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: stored } });
    },
  };
}
