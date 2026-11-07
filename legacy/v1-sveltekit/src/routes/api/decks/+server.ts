import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { errorResponse, readJson } from '#lib/server/auth/http.js';
import { deckCreateSchema } from '#lib/server/domain/core/validation.js';
import { getDomainContext } from '#lib/server/domain/context.js';
import { createDeck, listDecks } from '#lib/server/domain/decks.js';

export const GET: RequestHandler = async () => {
  const result = await listDecks(getDomainContext());
  return result.ok ? json({ decks: result.decks }) : errorResponse(result);
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await readJson(request, deckCreateSchema);
  if (!body.ok) {
    return body.response;
  }
  const result = await createDeck(getDomainContext(), body.data);
  return result.ok ? json({ deck: result.deck }, { status: 201 }) : errorResponse(result);
};
