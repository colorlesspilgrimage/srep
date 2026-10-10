import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext } from '#lib/server/auth/context.js';
import { SETUP_FAILURE_KEY } from '#lib/server/auth/limiters.js';
import {
  checkAttempts,
  checkBlocked,
  errorResponse,
  readJson,
  runLimited,
} from '#lib/server/auth/http.js';
import { setupOptionsSchema } from '#lib/server/auth/schemas.js';
import { setupOptions } from '#lib/server/auth/setup.js';

export const POST: RequestHandler = async (event) => {
  const ctx = getAuthContext();
  const failures = ctx.limiters.setupTokenFailures;
  const blocked = checkAttempts(event, ctx) ?? checkBlocked(failures, SETUP_FAILURE_KEY);
  if (blocked !== null) {
    return blocked;
  }
  const body = await readJson(event.request, setupOptionsSchema);
  if (!body.ok) {
    return body.response;
  }
  const result = await runLimited(failures, SETUP_FAILURE_KEY, 'setup_token_invalid', () =>
    setupOptions(ctx.deps, body.data),
  );
  if (result instanceof Response) {
    return result;
  }
  if (!result.ok) {
    return errorResponse(result);
  }
  return json({ options: result.options, challengeId: result.challengeId });
};
