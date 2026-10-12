import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { errorResponse, readJson } from '#lib/server/auth/http.js';
import { cardIdsSchema } from '#lib/server/study/core/validation.js';
import { getStudyContext } from '#lib/server/study/context.js';
import { unsuspendCards } from '#lib/server/study/card-state.js';

// Body: { cardIds } (1 to 500 ids). All or nothing.
export const POST: RequestHandler = async ({ request }) => {
  const body = await readJson(request, cardIdsSchema);
  if (!body.ok) {
    return body.response;
  }
  const result = await unsuspendCards(getStudyContext(), body.data.cardIds);
  return result.ok ? json({ ok: true }) : errorResponse(result);
};
