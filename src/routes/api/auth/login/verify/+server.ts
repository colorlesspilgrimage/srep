import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext } from '#lib/server/auth/context.js';
import {
  checkAttempts,
  errorResponse,
  readJson,
  setSessionCookie,
  userAgentOf,
} from '#lib/server/auth/http.js';
import { loginVerify } from '#lib/server/auth/login.js';
import { loginVerifySchema } from '#lib/server/auth/schemas.js';
import { csrfTokenFor } from '#lib/server/auth/tokens.js';

export const POST: RequestHandler = async (event) => {
  const ctx = getAuthContext();
  const blocked = checkAttempts(event, ctx);
  if (blocked !== null) {
    return blocked;
  }
  const body = await readJson(event.request, loginVerifySchema);
  if (!body.ok) {
    return body.response;
  }
  const result = await loginVerify(ctx.deps, { ...body.data, userAgent: userAgentOf(event) });
  if (!result.ok) {
    return errorResponse(result);
  }
  setSessionCookie(event.cookies, ctx.deps.auth, result.sessionToken, result.maxAgeSec);
  return json({ csrfToken: csrfTokenFor(result.sessionToken) });
};
