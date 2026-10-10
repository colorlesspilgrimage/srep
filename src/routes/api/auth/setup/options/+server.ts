import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext } from '#lib/server/auth/context.js';
import { SETUP_FAILURE_KEY } from '#lib/server/auth/limiters.js';
import {
  checkAttempts,
  errorResponse,
  readJson,
  reserveFailure,
  settleFailure,
} from '#lib/server/auth/http.js';
import { setupOptionsSchema } from '#lib/server/auth/schemas.js';
import { setupOptions } from '#lib/server/auth/setup.js';

export const POST: RequestHandler = async (event) => {
  const ctx = getAuthContext();
  const failures = ctx.limiters.setupTokenFailures;
  const blocked = checkAttempts(event, ctx) ?? reserveFailure(failures, SETUP_FAILURE_KEY);
  if (blocked !== null) {
    return blocked;
  }
  const body = await readJson(event.request, setupOptionsSchema);
  if (!body.ok) {
    failures.release(SETUP_FAILURE_KEY);
    return body.response;
  }
  const result = await setupOptions(ctx.deps, body.data);
  settleFailure(failures, SETUP_FAILURE_KEY, result, 'setup_token_invalid');
  if (!result.ok) {
    return errorResponse(result);
  }
  return json({ options: result.options, challengeId: result.challengeId });
};
