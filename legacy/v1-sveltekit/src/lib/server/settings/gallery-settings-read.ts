import { themeIdFromQuery } from '#lib/client/tui/themes.js';
import type { DisplayPrefs } from '#lib/client/app/display-prefs.js';
import type { KeybindMap } from '#lib/client/tui/keymap.js';
import type { Result } from '#lib/server/auth/deps.js';
import type { DbHandle } from '#lib/server/db/client.js';
import { getLogger } from '#lib/server/logger.js';
import {
  getDisplaySettings,
  interpretDisplay,
  type DisplaySettingsLogger,
} from '#lib/server/settings/display-settings.js';
import { getDisplayStore } from '#lib/server/settings/display-store.js';
import {
  getKeybindSettings,
  interpretKeybinds,
  type KeybindSettingsLogger,
} from '#lib/server/settings/keybind-settings.js';
import { getKeybindStore } from '#lib/server/settings/keybind-store.js';
import { interpretTheme, type ThemeSettingsLogger } from '#lib/server/settings/theme-settings.js';
import { getThemeStore } from '#lib/server/settings/theme-store.js';

type Cells = { theme: unknown; keybinds: unknown; display: unknown };

export type GallerySettings = {
  themeId: string;
  keybinds: KeybindMap;
  display: DisplayPrefs;
};

async function readCells(handle: DbHandle): Promise<Cells> {
  const theme = await getThemeStore(handle).getThemeValue();
  const keybinds = await getKeybindStore(handle).getKeybindValue();
  const display = await getDisplayStore(handle).getDisplayValue();
  return { theme, keybinds, display };
}

async function readSavedTriple(
  handle: DbHandle,
  themeLogger: ThemeSettingsLogger,
  keyLogger: KeybindSettingsLogger,
  displayLogger: DisplaySettingsLogger,
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
  const display = interpretDisplay(cells.display, displayLogger);
  if (!display.ok) {
    return display;
  }
  return {
    ok: true,
    themeId: theme.id,
    keybinds: keys.keybinds,
    display: display.display,
  };
}

async function readQuerySettings(
  handle: DbHandle,
  themeQuery: string,
  keyLogger: KeybindSettingsLogger,
  displayLogger: DisplaySettingsLogger,
): Promise<Result<GallerySettings>> {
  const keys = await getKeybindSettings(getKeybindStore(handle), keyLogger);
  if (!keys.ok) {
    return keys;
  }
  const display = await getDisplaySettings(getDisplayStore(handle), displayLogger);
  if (!display.ok) {
    return display;
  }
  return {
    ok: true,
    themeId: themeIdFromQuery(themeQuery),
    keybinds: keys.keybinds,
    display: display.display,
  };
}

export async function readGallerySettings(
  handle: DbHandle,
  themeQuery: string | null,
): Promise<Result<GallerySettings>> {
  const logger = getLogger();
  if (themeQuery !== null) {
    return readQuerySettings(handle, themeQuery, logger, logger);
  }
  return readSavedTriple(handle, logger, logger, logger);
}
