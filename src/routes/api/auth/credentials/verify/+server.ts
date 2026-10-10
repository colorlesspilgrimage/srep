import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext } from '#lib/server/auth/context.js';
import { registerVerify } from '#lib/server/auth/credentials.js';
import { checkAttempts, errorResponse, readJson } from '#lib/server/auth/http.js';
import { registerVerifySchema } from '#lib/server/auth/schemas.js';

export const POST: RequestHandler = async (event) => {
  const ctx = getAuthContext();
  const blocked = checkAttempts(event, ctx);
  if (blocked !== null) {
    return blocked;
  }
  const body = await readJson(event.request, registerVerifySchema);
  if (!body.ok) {
    return body.response;
  }
  const result = await registerVerify(ctx.deps, body.data);
  if (!result.ok) {
    return errorResponse(result);
  }
  return json({ credential: result.credential });
};
