import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { errorResponse, readJson } from '#lib/server/auth/http.js';
import { emptyBodySchema } from '#lib/server/study/core/validation.js';
import { getStudyContext } from '#lib/server/study/context.js';
import { rebuildFromLog } from '#lib/server/study/replay-service.js';

// Body: {}. Rewrites the cached card schedule from the review log.
export const POST: RequestHandler = async ({ request }) => {
  const body = await readJson(request, emptyBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const result = await rebuildFromLog(getStudyContext());
  return result.ok
    ? json({ checked: result.checked, changed: result.changed, skipped: result.skipped })
    : errorResponse(result);
};
