// Contract: read the gallery theme and the key chords.
// A null theme query reads both rows in one snapshot. A theme query reads only the chords.
// A bad row is 500. This read does not write (CWE-362).

import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DEFAULT_THEME_ID, themeById, themeIdFromQuery } from '#lib/client/tui/themes.js';
import type { KeybindMap } from '#lib/client/tui/keymap.js';
import { fail, type Result } from '#lib/server/auth/deps.js';
import type { DbHandle } from '#lib/server/db/client.js';
import { appSettings as pgSettings } from '#lib/server/db/schema/pg.js';
import { appSettings as sqliteSettings } from '#lib/server/db/schema/sqlite.js';
import { getLogger } from '#lib/server/logger.js';
import { KEYBIND_SETTINGS_KEY } from '#lib/server/settings/keybind-key.js';
import {
  getKeybindSettings,
  interpretKeybinds,
  type KeybindSettingsLogger,
} from '#lib/server/settings/keybind-settings.js';
import { getKeybindStore } from '#lib/server/settings/keybind-store.js';
import { THEME_SETTINGS_KEY } from '#lib/server/settings/theme-key.js';
import {
  themeSettingsSchema,
  type ThemeSettingsLogger,
} from '#lib/server/settings/theme-settings.js';
import { PG_READ_SNAPSHOT } from '#lib/server/study/store/read-snapshot.pg.js';

type Cells = { theme: unknown; keybinds: unknown };

export type GallerySettings = {
  themeId: string;
  keybinds: KeybindMap;
};

function themeFromStored(stored: unknown, logger: ThemeSettingsLogger): Result<{ id: string }> {
  if (stored === undefined) {
    return { ok: true, id: DEFAULT_THEME_ID };
  }
  const parsed = themeSettingsSchema.safeParse(stored);
  if (!parsed.success || themeById(parsed.data.id) === undefined) {
    logger.error({ key: 'theme' });
    return fail(500, 'settings_corrupt');
  }
  return { ok: true, id: parsed.data.id };
}

function readSqliteCells(db: BetterSQLite3Database): Cells {
  return db.transaction((tx) => {
    const theme = tx
      .select({ value: sqliteSettings.value })
      .from(sqliteSettings)
      .where(eq(sqliteSettings.key, THEME_SETTINGS_KEY))
      .get();
    const keybinds = tx
      .select({ value: sqliteSettings.value })
      .from(sqliteSettings)
      .where(eq(sqliteSettings.key, KEYBIND_SETTINGS_KEY))
      .get();
    return { theme: theme?.value, keybinds: keybinds?.value };
  });
}

async function readPgCells(db: PostgresJsDatabase): Promise<Cells> {
  return db.transaction(async (tx) => {
    const [theme] = await tx
      .select({ value: pgSettings.value })
      .from(pgSettings)
      .where(eq(pgSettings.key, THEME_SETTINGS_KEY));
    const [keybinds] = await tx
      .select({ value: pgSettings.value })
      .from(pgSettings)
      .where(eq(pgSettings.key, KEYBIND_SETTINGS_KEY));
    return { theme: theme?.value, keybinds: keybinds?.value };
  }, PG_READ_SNAPSHOT);
}

async function readCells(handle: DbHandle): Promise<Cells> {
  if (handle.dialect === 'sqlite') {
    return readSqliteCells(handle.db);
  }
  return readPgCells(handle.db);
}

async function readSavedPair(
  handle: DbHandle,
  themeLogger: ThemeSettingsLogger,
  keyLogger: KeybindSettingsLogger,
): Promise<Result<GallerySettings>> {
  const cells = await readCells(handle);
  const theme = themeFromStored(cells.theme, themeLogger);
  if (!theme.ok) {
    return theme;
  }
  const keys = interpretKeybinds(cells.keybinds, keyLogger);
  if (!keys.ok) {
    return keys;
  }
  return { ok: true, themeId: theme.id, keybinds: keys.keybinds };
}

async function readQuerySettings(
  handle: DbHandle,
  themeQuery: string,
  keyLogger: KeybindSettingsLogger,
): Promise<Result<GallerySettings>> {
  const keys = await getKeybindSettings(getKeybindStore(handle), keyLogger);
  if (!keys.ok) {
    return keys;
  }
  return { ok: true, themeId: themeIdFromQuery(themeQuery), keybinds: keys.keybinds };
}

export async function readGallerySettings(
  handle: DbHandle,
  themeQuery: string | null,
): Promise<Result<GallerySettings>> {
  const logger = getLogger();
  if (themeQuery !== null) {
    return readQuerySettings(handle, themeQuery, logger);
  }
  return readSavedPair(handle, logger, logger);
}
