import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { errorResponse, readJson } from '#lib/server/auth/http.js';
import { getDb } from '#lib/server/db/index.js';
import { getLogger } from '#lib/server/logger.js';
import {
  getThemeSettings,
  putThemeSettings,
  themeSettingsSchema,
} from '#lib/server/settings/theme-settings.js';
import { getThemeStore } from '#lib/server/settings/theme-store.js';

// Contract: read and replace the saved theme.
// The auth hook requires a session, origin, and x-srep-csrf on PUT (CWE-352, CWE-862).

export const GET: RequestHandler = async () => {
  const result = await getThemeSettings(getThemeStore(getDb()), getLogger());
  return result.ok ? json({ id: result.id }) : errorResponse(result);
};

export const PUT: RequestHandler = async ({ request }) => {
  const body = await readJson(request, themeSettingsSchema);
  if (!body.ok) {
    return body.response;
  }
  const result = await putThemeSettings(getThemeStore(getDb()), body.data.id);
  return result.ok ? json({ id: result.id }) : errorResponse(result);
};
