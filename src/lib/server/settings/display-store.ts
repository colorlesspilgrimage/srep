// Contract: the saved display store. SQLite and Postgres each have one factory.

import type { DisplayPrefs } from '#lib/client/app/display-prefs.js';
import type { DbHandle } from '#lib/server/db/client.js';
import { createPgDisplayStore } from '#lib/server/settings/display-store.pg.js';
import { createSqliteDisplayStore } from '#lib/server/settings/display-store.sqlite.js';

export type DisplaySettingsStore = {
  getDisplayValue(): Promise<unknown>;
  putDisplayValue(value: DisplayPrefs): Promise<void>;
};

export function getDisplayStore(handle: DbHandle): DisplaySettingsStore {
  return handle.dialect === 'sqlite'
    ? createSqliteDisplayStore(handle.db)
    : createPgDisplayStore(handle.db);
}
