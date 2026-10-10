import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext } from '#lib/server/auth/context.js';
import { RECOVERY_FAILURE_KEY } from '#lib/server/auth/limiters.js';
import {
  checkAttempts,
  checkBlocked,
  errorResponse,
  readJson,
  recordFailure,
  setSessionCookie,
  userAgentOf,
} from '#lib/server/auth/http.js';
import { recoveryLogin } from '#lib/server/auth/recovery.js';
import { recoveryLoginSchema } from '#lib/server/auth/schemas.js';
import { csrfTokenFor } from '#lib/server/auth/tokens.js';

export const POST: RequestHandler = async (event) => {
  const ctx = getAuthContext();
  const failures = ctx.limiters.recoveryFailures;
  const blocked = checkAttempts(event, ctx) ?? checkBlocked(failures, RECOVERY_FAILURE_KEY);
  if (blocked !== null) {
    return blocked;
  }
  const body = await readJson(event.request, recoveryLoginSchema);
  if (!body.ok) {
    return body.response;
  }
  const result = await recoveryLogin(ctx.deps, { ...body.data, userAgent: userAgentOf(event) });
  if (!result.ok) {
    recordFailure(failures, RECOVERY_FAILURE_KEY, result, 'recovery_failed');
    return errorResponse(result);
  }
  setSessionCookie(event.cookies, ctx.deps.auth, result.sessionToken, result.maxAgeSec);
  return json({ csrfToken: csrfTokenFor(result.sessionToken), remaining: result.remaining });
};
