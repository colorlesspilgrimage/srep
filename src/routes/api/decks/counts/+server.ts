// Contract: GET /api/decks/counts.
// Calls getDeckCounts. Does not write. Does not call unburyExpired.
// Success: JSON { counts }. Failure: the error status and code.
// A guest is rejected by the auth hook before this handler runs.

import type { RequestHandler } from './$types';
import { privateJson } from '#lib/server/http/private-page.js';
import { getStudyContext } from '#lib/server/study/context.js';
import { getDeckCounts } from '#lib/server/study/deck-counts.js';

export const GET: RequestHandler = async () => {
  const result = await getDeckCounts(getStudyContext());
  if (!result.ok) {
    return privateJson({ error: result.error }, result.status);
  }
  return privateJson({ counts: result.counts });
};
