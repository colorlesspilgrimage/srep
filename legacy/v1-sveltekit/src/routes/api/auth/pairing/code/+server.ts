import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext } from '#lib/server/auth/context.js';
import { errorResponse, readJson } from '#lib/server/auth/http.js';
import { createPairingCode } from '#lib/server/auth/pairing.js';
import { pairingCodeSchema } from '#lib/server/auth/schemas.js';

export const POST: RequestHandler = async (event) => {
  const { deps } = getAuthContext();
  const body = await readJson(event.request, pairingCodeSchema);
  if (!body.ok) {
    return body.response;
  }
  const result = await createPairingCode(deps, body.data);
  if (!result.ok) {
    return errorResponse(result);
  }
  return json({
    code: result.code,
    expiresAt: result.expiresAt,
    qrPayload: result.qrPayload,
  });
};
