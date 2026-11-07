import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext } from '#lib/server/auth/context.js';
import {
  checkAttempts,
  errorResponse,
  readJson,
  reserveFailure,
  settleFailure,
} from '#lib/server/auth/http.js';
import { PAIRING_FAILURE_KEY } from '#lib/server/auth/limiters.js';
import { exchangePairingCode } from '#lib/server/auth/pairing.js';
import { pairingExchangeSchema } from '#lib/server/auth/schemas.js';

export const POST: RequestHandler = async (event) => {
  const ctx = getAuthContext();
  const failures = ctx.limiters.pairingFailures;
  const blocked = checkAttempts(event, ctx) ?? reserveFailure(failures, PAIRING_FAILURE_KEY);
  if (blocked !== null) {
    return blocked;
  }
  const body = await readJson(event.request, pairingExchangeSchema);
  if (!body.ok) {
    failures.release(PAIRING_FAILURE_KEY);
    return body.response;
  }
  const result = await exchangePairingCode(ctx.deps, body.data);
  settleFailure(failures, PAIRING_FAILURE_KEY, result, 'pairing_failed');
  if (!result.ok) {
    return errorResponse(result);
  }
  return json({
    token: result.token,
    tokenId: result.tokenId,
    name: result.name,
  });
};
