import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { errorResponse, readJson } from '#lib/server/auth/http.js';
import { getDb } from '#lib/server/db/index.js';
import { getLogger } from '#lib/server/logger.js';
import {
  displaySettingsSchema,
  getDisplaySettings,
  putDisplaySettings,
} from '#lib/server/settings/display-settings.js';
import { getDisplayStore } from '#lib/server/settings/display-store.js';

// Contract: read and replace the saved display prefs.
// The auth hook requires a session, origin, and x-srep-csrf on PUT (CWE-352, CWE-862).
// Responses are not stored. The cache key includes the session cookie (CWE-524).

function withDisplayCache(response: Response): Response {
  response.headers.set('cache-control', 'no-store');
  response.headers.set('vary', 'Cookie');
  return response;
}

export const GET: RequestHandler = async () => {
  const result = await getDisplaySettings(getDisplayStore(getDb()), getLogger());
  const response = result.ok ? json({ display: result.display }) : errorResponse(result);
  return withDisplayCache(response);
};

export const PUT: RequestHandler = async ({ request }) => {
  const body = await readJson(request, displaySettingsSchema);
  if (!body.ok) {
    return withDisplayCache(body.response);
  }
  const result = await putDisplaySettings(getDisplayStore(getDb()), body.data);
  const response = result.ok ? json({ display: result.display }) : errorResponse(result);
  return withDisplayCache(response);
};
