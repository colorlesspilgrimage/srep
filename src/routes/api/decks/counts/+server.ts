// Contract: GET /api/decks/counts.
// Calls getDeckCounts. Does not write. Does not call unburyExpired.
// Success: JSON { counts }. Failure: the error status and code.
// A guest is rejected by the auth hook before this handler runs.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { privatePageHeaders } from '#lib/server/http/private-page.js';
import { getStudyContext } from '#lib/server/study/context.js';
import { getDeckCounts } from '#lib/server/study/deck-counts.js';

// The body is per session. A cache must not store it (CWE-525).
function privateJson(body: unknown, status = 200): Response {
  return json(body, { status, headers: privatePageHeaders() });
}

export const GET: RequestHandler = async () => {
  const result = await getDeckCounts(getStudyContext());
  if (!result.ok) {
    return privateJson({ error: result.error }, result.status);
  }
  return privateJson({ counts: result.counts });
};
