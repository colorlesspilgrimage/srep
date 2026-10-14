// Contract: read the gallery theme and the key chords.
// A null theme query reads the saved theme and the saved chords.
// A theme query reads only the chords.
// Both reads use the process cache. A bad row is 500.
// This read does not write (CWE-362).

import { themeIdFromQuery } from '#lib/client/tui/themes.js';
import type { KeybindMap } from '#lib/client/tui/keymap.js';
import type { Result } from '#lib/server/auth/deps.js';
import type { DbHandle } from '#lib/server/db/client.js';
import { getLogger } from '#lib/server/logger.js';
import {
  getKeybindSettings,
  interpretKeybinds,
  type KeybindSettingsLogger,
} from '#lib/server/settings/keybind-settings.js';
import { getKeybindStore } from '#lib/server/settings/keybind-store.js';
import { interpretTheme, type ThemeSettingsLogger } from '#lib/server/settings/theme-settings.js';
import { getThemeStore } from '#lib/server/settings/theme-store.js';

type Cells = { theme: unknown; keybinds: unknown };

export type GallerySettings = {
  themeId: string;
  keybinds: KeybindMap;
};

async function readCells(handle: DbHandle): Promise<Cells> {
  const theme = await getThemeStore(handle).getThemeValue();
  const keybinds = await getKeybindStore(handle).getKeybindValue();
  return { theme, keybinds };
}

async function readSavedPair(
  handle: DbHandle,
  themeLogger: ThemeSettingsLogger,
  keyLogger: KeybindSettingsLogger,
): Promise<Result<GallerySettings>> {
  const cells = await readCells(handle);
  const theme = interpretTheme(cells.theme, themeLogger);
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
