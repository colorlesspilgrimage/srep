import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { errorResponse, readJson } from '#lib/server/auth/http.js';
import { cardsMoveSchema } from '#lib/server/domain/core/validation.js';
import { getDomainContext } from '#lib/server/domain/context.js';
import { moveCards } from '#lib/server/domain/notes.js';

export const POST: RequestHandler = async ({ request }) => {
  const body = await readJson(request, cardsMoveSchema);
  if (!body.ok) {
    return body.response;
  }
  const result = await moveCards(getDomainContext(), body.data);
  return result.ok ? json({ ok: true }) : errorResponse(result);
};
