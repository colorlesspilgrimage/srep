// Contract: GET /api/decks/counts.
// Calls getDeckCounts. Does not write. Does not call unburyExpired.
// Success: JSON { counts }. Failure: the error status and code.
// A guest is rejected by the auth hook before this handler runs.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { errorResponse } from '#lib/server/auth/http.js';
import { getStudyContext } from '#lib/server/study/context.js';
import { getDeckCounts } from '#lib/server/study/deck-counts.js';

export const GET: RequestHandler = async () => {
  const result = await getDeckCounts(getStudyContext());
  return result.ok ? json({ counts: result.counts }) : errorResponse(result);
};
