import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { errorResponse, readJson } from '#lib/server/auth/http.js';
import { emptyBodySchema } from '#lib/server/study/core/validation.js';
import { getStudyContext } from '#lib/server/study/context.js';
import { undo } from '#lib/server/study/study-answer.js';

// Body: {}. Reverts the most recent review.
export const POST: RequestHandler = async ({ request }) => {
  const body = await readJson(request, emptyBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const result = await undo(getStudyContext());
  return result.ok ? json({ ok: true, undone: result.undone }) : errorResponse(result);
};
