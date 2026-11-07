import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { copyKeybindMap, type KeybindMap } from '#lib/client/tui/keymap.js';
import { createSqliteAppSettingsSlot } from '#lib/server/settings/app-settings-store.js';
import { KEYBIND_SETTINGS_KEY } from '#lib/server/settings/keybind-key.js';
import type { KeybindSettingsStore } from '#lib/server/settings/keybind-store.js';

export function createSqliteKeybindStore(db: BetterSQLite3Database): KeybindSettingsStore {
  const slot = createSqliteAppSettingsSlot(db, {
    key: KEYBIND_SETTINGS_KEY,
    cacheSlot: 'keybinds',
    normalize: (value: KeybindMap) => copyKeybindMap(value),
    absentValue: null,
  });
  return {
    getKeybindValue: () => slot.getValue(),
    putKeybindValue: (value) => slot.putValue(value),
  };
}
