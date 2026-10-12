import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { badRequest, errorResponse } from '#lib/server/auth/http.js';
import { studyNextQuerySchema } from '#lib/server/study/core/validation.js';
import { getStudyContext } from '#lib/server/study/context.js';
import { getNext } from '#lib/server/study/study-next.js';

// GET /api/study/next?deckId=<uuid>. Without deckId, all decks.
// The card front and back are rendered text that is NOT sanitized (same contract as M2).
// The client must sanitize them before display (CWE-79).
export const GET: RequestHandler = async ({ url }) => {
  const query = studyNextQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!query.success) {
    return badRequest();
  }
  const result = await getNext(getStudyContext(), query.data);
  return result.ok ? json(result.reply) : errorResponse(result);
};
