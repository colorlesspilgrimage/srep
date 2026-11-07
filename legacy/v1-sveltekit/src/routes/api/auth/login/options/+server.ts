import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext } from '#lib/server/auth/context.js';
import { checkAttempts, errorResponse, readJson } from '#lib/server/auth/http.js';
import { loginOptions } from '#lib/server/auth/login.js';
import { loginOptionsSchema } from '#lib/server/auth/schemas.js';

export const POST: RequestHandler = async (event) => {
  const ctx = getAuthContext();
  const blocked = checkAttempts(event, ctx);
  if (blocked !== null) {
    return blocked;
  }
  const body = await readJson(event.request, loginOptionsSchema);
  if (!body.ok) {
    return body.response;
  }
  const result = await loginOptions(ctx.deps, { kind: body.data.kind ?? 'passkey' });
  if (!result.ok) {
    return errorResponse(result);
  }
  return json({ options: result.options, challengeId: result.challengeId });
};
