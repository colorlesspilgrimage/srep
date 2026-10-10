import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext } from '#lib/server/auth/context.js';
import { renameCredential, revokeCredential } from '#lib/server/auth/credentials.js';
import { errorResponse, readJson } from '#lib/server/auth/http.js';
import { credentialIdSchema, renameSchema } from '#lib/server/auth/schemas.js';

export const PATCH: RequestHandler = async ({ request, params }) => {
  const id = credentialIdSchema.safeParse(params.id);
  if (!id.success) {
    return json({ error: 'bad_request' }, { status: 400 });
  }
  const body = await readJson(request, renameSchema);
  if (!body.ok) {
    return body.response;
  }
  const result = await renameCredential(getAuthContext().deps, id.data, body.data.nickname);
  return result.ok ? json({ ok: true }) : errorResponse(result);
};

export const DELETE: RequestHandler = async ({ params }) => {
  const id = credentialIdSchema.safeParse(params.id);
  if (!id.success) {
    return json({ error: 'bad_request' }, { status: 400 });
  }
  const result = await revokeCredential(getAuthContext().deps, id.data);
  return result.ok ? json({ ok: true }) : errorResponse(result);
};
