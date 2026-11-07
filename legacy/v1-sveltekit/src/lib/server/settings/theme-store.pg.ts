import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { createPgAppSettingsSlot } from '#lib/server/settings/app-settings-store.js';
import { THEME_SETTINGS_KEY } from '#lib/server/settings/theme-key.js';
import type { ThemeSettingsStore } from '#lib/server/settings/theme-store.js';

export function createPgThemeStore(db: PostgresJsDatabase): ThemeSettingsStore {
  const slot = createPgAppSettingsSlot(db, {
    key: THEME_SETTINGS_KEY,
    cacheSlot: 'theme',
    normalize: (value: { id: string }) => ({ id: value.id }),
  });
  return {
    getThemeValue: () => slot.getValue(),
    putThemeValue: (value) => slot.putValue(value),
  };
}
