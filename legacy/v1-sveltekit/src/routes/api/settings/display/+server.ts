import { getDb } from '#lib/server/db/index.js';
import { getLogger } from '#lib/server/logger.js';
import { createSettingsRouteHandlers } from '#lib/server/http/settings-route.js';
import {
  displaySettingsSchema,
  getDisplaySettings,
  putDisplaySettings,
} from '#lib/server/settings/display-settings.js';
import { getDisplayStore } from '#lib/server/settings/display-store.js';

export const { GET, PUT } = createSettingsRouteHandlers({
  schema: displaySettingsSchema,
  getSettings: () => getDisplaySettings(getDisplayStore(getDb()), getLogger()),
  putSettings: (display) => putDisplaySettings(getDisplayStore(getDb()), display),
  getBody: (result) => ({ display: result.display }),
  putBody: (result) => ({ display: result.display }),
});
