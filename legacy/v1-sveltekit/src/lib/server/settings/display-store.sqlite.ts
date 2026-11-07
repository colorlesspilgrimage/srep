import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { DisplayPrefs } from '#lib/client/app/display-prefs.js';
import { createSqliteAppSettingsSlot } from '#lib/server/settings/app-settings-store.js';
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

export function createSqliteDisplayStore(db: BetterSQLite3Database): DisplaySettingsStore {
  const slot = createSqliteAppSettingsSlot(db, {
    key: DISPLAY_SETTINGS_KEY,
    cacheSlot: 'display',
    normalize: storedPrefs,
  });
  return {
    getDisplayValue: () => slot.getValue(),
    putDisplayValue: (value) => slot.putValue(value),
  };
}
