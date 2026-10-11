import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { badRequest, errorResponse, readJson } from '#lib/server/auth/http.js';
import { deckDeleteSchema, deckPatchSchema, idSchema } from '#lib/server/domain/core/validation.js';
import { getDomainContext } from '#lib/server/domain/context.js';
import { deleteDeck, getDeck, updateDeck } from '#lib/server/domain/decks.js';

export const GET: RequestHandler = async ({ params }) => {
  const id = idSchema.safeParse(params.id);
  if (!id.success) {
    return badRequest();
  }
  const result = await getDeck(getDomainContext(), id.data);
  return result.ok ? json({ deck: result.deck }) : errorResponse(result);
};

// Rename, move, preset and description change. The reply lists every changed deck.
export const PATCH: RequestHandler = async ({ request, params }) => {
  const id = idSchema.safeParse(params.id);
  if (!id.success) {
    return badRequest();
  }
  const body = await readJson(request, deckPatchSchema);
  if (!body.ok) {
    return body.response;
  }
  const result = await updateDeck(getDomainContext(), id.data, body.data);
  return result.ok ? json({ decks: result.decks }) : errorResponse(result);
};

export const DELETE: RequestHandler = async ({ request, params }) => {
  const id = idSchema.safeParse(params.id);
  if (!id.success) {
    return badRequest();
  }
  const body = await readJson(request, deckDeleteSchema);
  if (!body.ok) {
    return body.response;
  }
  const result = await deleteDeck(getDomainContext(), id.data, body.data);
  return result.ok ? json({ ok: true }) : errorResponse(result);
};
