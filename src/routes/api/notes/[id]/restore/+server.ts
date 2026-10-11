import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { badRequest, errorResponse, readJson } from '#lib/server/auth/http.js';
import { idSchema, noteRestoreSchema } from '#lib/server/domain/core/validation.js';
import { getDomainContext } from '#lib/server/domain/context.js';
import { restoreNote } from '#lib/server/domain/notes.js';

export const POST: RequestHandler = async ({ request, params }) => {
  const id = idSchema.safeParse(params.id);
  if (!id.success) {
    return badRequest();
  }
  const body = await readJson(request, noteRestoreSchema);
  if (!body.ok) {
    return body.response;
  }
  const result = await restoreNote(getDomainContext(), id.data, body.data);
  return result.ok ? json({ note: result.note }) : errorResponse(result);
};
