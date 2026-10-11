import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { badRequest, errorResponse } from '#lib/server/auth/http.js';
import { parseId } from '#lib/server/domain/core/validation.js';
import { getDomainContext } from '#lib/server/domain/context.js';
import { getDeckImpact } from '#lib/server/domain/decks.js';

export const GET: RequestHandler = async ({ params }) => {
  const id = parseId(params.id);
  if (id === null) {
    return badRequest();
  }
  const result = await getDeckImpact(getDomainContext(), id);
  if (!result.ok) {
    return errorResponse(result);
  }
  return json({ decks: result.decks, cards: result.cards, notes: result.notes });
};
