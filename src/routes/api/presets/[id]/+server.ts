import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { badRequest, errorResponse, readJson } from '#lib/server/auth/http.js';
import { idSchema, presetSchema } from '#lib/server/domain/core/validation.js';
import { getDomainContext } from '#lib/server/domain/context.js';
import { deletePreset, updatePreset } from '#lib/server/domain/presets.js';

// A full replace of the preset.
export const PUT: RequestHandler = async ({ request, params }) => {
  const id = idSchema.safeParse(params.id);
  if (!id.success) {
    return badRequest();
  }
  const body = await readJson(request, presetSchema);
  if (!body.ok) {
    return body.response;
  }
  const result = await updatePreset(getDomainContext(), id.data, body.data);
  return result.ok ? json({ preset: result.preset }) : errorResponse(result);
};

export const DELETE: RequestHandler = async ({ params }) => {
  const id = idSchema.safeParse(params.id);
  if (!id.success) {
    return badRequest();
  }
  const result = await deletePreset(getDomainContext(), id.data);
  return result.ok ? json({ ok: true }) : errorResponse(result);
};
