// Contract: the Postgres store for the saved theme.
// One upsert replaces the whole value. The statement is the transaction (CWE-362, CWE-89).

import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { appSettings } from '#lib/server/db/schema/pg.js';
import { THEME_SETTINGS_KEY } from '#lib/server/settings/theme-key.js';
import type { ThemeSettingsStore } from '#lib/server/settings/theme-store.js';

export function createPgThemeStore(db: PostgresJsDatabase): ThemeSettingsStore {
  return {
    async getThemeValue() {
      const [row] = await db
        .select({ value: appSettings.value })
        .from(appSettings)
        .where(eq(appSettings.key, THEME_SETTINGS_KEY));
      return row?.value;
    },

    async putThemeValue(value) {
      await db
        .insert(appSettings)
        .values({ key: THEME_SETTINGS_KEY, value })
        .onConflictDoUpdate({ target: appSettings.key, set: { value } });
    },
  };
}
