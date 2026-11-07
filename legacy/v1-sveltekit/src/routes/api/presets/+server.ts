import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { errorResponse, readJson } from '#lib/server/auth/http.js';
import { presetSchema } from '#lib/server/domain/core/validation.js';
import { getDomainContext } from '#lib/server/domain/context.js';
import { createPreset, listPresets } from '#lib/server/domain/presets.js';

export const GET: RequestHandler = async () => {
  const result = await listPresets(getDomainContext());
  return result.ok ? json({ presets: result.presets }) : errorResponse(result);
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await readJson(request, presetSchema);
  if (!body.ok) {
    return body.response;
  }
  const result = await createPreset(getDomainContext(), body.data);
  return result.ok ? json({ preset: result.preset }, { status: 201 }) : errorResponse(result);
};
