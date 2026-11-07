import { getDb } from '#lib/server/db/index.js';
import { getLogger } from '#lib/server/logger.js';
import { createSettingsRouteHandlers } from '#lib/server/http/settings-route.js';
import {
  getThemeSettings,
  putThemeSettings,
  themeSettingsSchema,
} from '#lib/server/settings/theme-settings.js';
import { getThemeStore } from '#lib/server/settings/theme-store.js';

export const { GET, PUT } = createSettingsRouteHandlers({
  schema: themeSettingsSchema,
  getSettings: () => getThemeSettings(getThemeStore(getDb()), getLogger()),
  putSettings: (data) => putThemeSettings(getThemeStore(getDb()), data.id),
  getBody: (result) => ({ id: result.id }),
  putBody: (result) => ({ id: result.id }),
});
