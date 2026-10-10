import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext } from '#lib/server/auth/context.js';
import { SETUP_FAILURE_KEY } from '#lib/server/auth/limiters.js';
import { csrfTokenFor } from '#lib/server/auth/tokens.js';
import {
  checkAttempts,
  errorResponse,
  readJson,
  reserveFailure,
  setSessionCookie,
  settleFailure,
  userAgentOf,
} from '#lib/server/auth/http.js';
import { setupVerifySchema } from '#lib/server/auth/schemas.js';
import { setupVerify } from '#lib/server/auth/setup.js';

export const POST: RequestHandler = async (event) => {
  const ctx = getAuthContext();
  const failures = ctx.limiters.setupTokenFailures;
  const blocked = checkAttempts(event, ctx) ?? reserveFailure(failures, SETUP_FAILURE_KEY);
  if (blocked !== null) {
    return blocked;
  }
  const body = await readJson(event.request, setupVerifySchema);
  if (!body.ok) {
    failures.release(SETUP_FAILURE_KEY);
    return body.response;
  }
  const result = await setupVerify(ctx.deps, { ...body.data, userAgent: userAgentOf(event) });
  settleFailure(failures, SETUP_FAILURE_KEY, result, 'setup_token_invalid');
  if (!result.ok) {
    return errorResponse(result);
  }
  setSessionCookie(event.cookies, ctx.deps.auth, result.sessionToken, result.maxAgeSec);
  return json({
    recoveryCodes: result.recoveryCodes,
    credential: result.credential,
    csrfToken: csrfTokenFor(result.sessionToken),
  });
};
