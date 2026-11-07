import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { renameApiToken, revokeApiToken } from '#lib/server/auth/api-tokens.js';
import { getAuthContext } from '#lib/server/auth/context.js';
import { badRequest, errorResponse, readJson } from '#lib/server/auth/http.js';
import { tokenIdSchema, tokenRenameSchema } from '#lib/server/auth/schemas.js';

export const PATCH: RequestHandler = async ({ request, params }) => {
  const id = tokenIdSchema.safeParse(params.id);
  if (!id.success) {
    return badRequest();
  }
  const body = await readJson(request, tokenRenameSchema);
  if (!body.ok) {
    return body.response;
  }
  const result = await renameApiToken(getAuthContext().deps, id.data, body.data.name);
  return result.ok ? json({ ok: true }) : errorResponse(result);
};

export const DELETE: RequestHandler = async ({ params }) => {
  const id = tokenIdSchema.safeParse(params.id);
  if (!id.success) {
    return badRequest();
  }
  const result = await revokeApiToken(getAuthContext().deps, id.data);
  return result.ok ? json({ ok: true }) : errorResponse(result);
};
