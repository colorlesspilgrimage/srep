import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { errorResponse, readJson } from '#lib/server/auth/http.js';
import { getDb } from '#lib/server/db/index.js';
import { getLogger } from '#lib/server/logger.js';
import {
  getKeybindSettings,
  keybindSettingsSchema,
  putKeybindSettings,
} from '#lib/server/settings/keybind-settings.js';
import { getKeybindStore } from '#lib/server/settings/keybind-store.js';

// Contract: read and replace the saved key chords.
// The auth hook requires a session, origin, and x-srep-csrf on PUT (CWE-352, CWE-862).
// Responses are not stored. The cache key includes the session cookie (CWE-524).

function withKeybindCache(response: Response): Response {
  response.headers.set('cache-control', 'no-store');
  response.headers.set('vary', 'Cookie');
  return response;
}

export const GET: RequestHandler = async () => {
  const result = await getKeybindSettings(getKeybindStore(getDb()), getLogger());
  const response = result.ok ? json({ keybinds: result.keybinds }) : errorResponse(result);
  return withKeybindCache(response);
};

export const PUT: RequestHandler = async ({ request }) => {
  const body = await readJson(request, keybindSettingsSchema);
  if (!body.ok) {
    return withKeybindCache(body.response);
  }
  const result = await putKeybindSettings(getKeybindStore(getDb()), body.data);
  const response = result.ok ? json({ keybinds: result.keybinds }) : errorResponse(result);
  return withKeybindCache(response);
};
