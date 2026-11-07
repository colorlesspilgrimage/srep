import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { copyKeybindMap, type KeybindMap } from '#lib/client/tui/keymap.js';
import { createPgAppSettingsSlot } from '#lib/server/settings/app-settings-store.js';
import { KEYBIND_SETTINGS_KEY } from '#lib/server/settings/keybind-key.js';
import type { KeybindSettingsStore } from '#lib/server/settings/keybind-store.js';

export function createPgKeybindStore(db: PostgresJsDatabase): KeybindSettingsStore {
  const slot = createPgAppSettingsSlot(db, {
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
