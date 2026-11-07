import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createSqliteAppSettingsSlot } from '#lib/server/settings/app-settings-store.js';
import { THEME_SETTINGS_KEY } from '#lib/server/settings/theme-key.js';
import type { ThemeSettingsStore } from '#lib/server/settings/theme-store.js';

export function createSqliteThemeStore(db: BetterSQLite3Database): ThemeSettingsStore {
  const slot = createSqliteAppSettingsSlot(db, {
    key: THEME_SETTINGS_KEY,
    cacheSlot: 'theme',
    normalize: (value: { id: string }) => ({ id: value.id }),
  });
  return {
    getThemeValue: () => slot.getValue(),
    putThemeValue: (value) => slot.putValue(value),
  };
}
