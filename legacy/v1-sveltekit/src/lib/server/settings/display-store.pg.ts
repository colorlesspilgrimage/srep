import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { DisplayPrefs } from '#lib/client/app/display-prefs.js';
import { createPgAppSettingsSlot } from '#lib/server/settings/app-settings-store.js';
import { DISPLAY_SETTINGS_KEY } from '#lib/server/settings/display-key.js';
import type { DisplaySettingsStore } from '#lib/server/settings/display-store.js';

function storedPrefs(value: DisplayPrefs): DisplayPrefs {
  return {
    fontSize: value.fontSize,
    reducedMotion: value.reducedMotion,
    scanline: value.scanline,
    cursorBlink: value.cursorBlink,
  };
}

export function createPgDisplayStore(db: PostgresJsDatabase): DisplaySettingsStore {
  const slot = createPgAppSettingsSlot(db, {
    key: DISPLAY_SETTINGS_KEY,
    cacheSlot: 'display',
    normalize: storedPrefs,
  });
  return {
    getDisplayValue: () => slot.getValue(),
    putDisplayValue: (value) => slot.putValue(value),
  };
}
