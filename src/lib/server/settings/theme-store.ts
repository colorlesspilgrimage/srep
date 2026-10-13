// Contract: the saved theme store. SQLite and Postgres each have one factory.

import type { DbHandle } from '#lib/server/db/client.js';
import { createPgThemeStore } from '#lib/server/settings/theme-store.pg.js';
import { createSqliteThemeStore } from '#lib/server/settings/theme-store.sqlite.js';

export type ThemeSettingsStore = {
  getThemeValue(): Promise<unknown>;
  putThemeValue(value: { id: string }): Promise<void>;
};

export function getThemeStore(handle: DbHandle): ThemeSettingsStore {
  return handle.dialect === 'sqlite'
    ? createSqliteThemeStore(handle.db)
    : createPgThemeStore(handle.db);
}
