import { getDb } from '#lib/server/db/index.js';
import { getLogger } from '#lib/server/logger.js';
import { createSettingsRouteHandlers } from '#lib/server/http/settings-route.js';
import {
  getKeybindSettings,
  keybindSettingsSchema,
  putKeybindSettings,
} from '#lib/server/settings/keybind-settings.js';
import { getKeybindStore } from '#lib/server/settings/keybind-store.js';

export const { GET, PUT } = createSettingsRouteHandlers({
  schema: keybindSettingsSchema,
  getSettings: () => getKeybindSettings(getKeybindStore(getDb()), getLogger()),
  putSettings: (keybinds) => putKeybindSettings(getKeybindStore(getDb()), keybinds),
  getBody: (result) => ({ keybinds: result.keybinds }),
  putBody: (result) => ({ keybinds: result.keybinds }),
});
