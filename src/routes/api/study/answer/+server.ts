import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { errorResponse, readJson } from '#lib/server/auth/http.js';
import { answerSchema } from '#lib/server/study/core/validation.js';
import { getStudyContext } from '#lib/server/study/context.js';
import { withTestClock } from '#lib/server/study/request-clock.js';
import { answer } from '#lib/server/study/study-answer.js';

export const POST: RequestHandler = async ({ request }) => {
  const body = await readJson(request, answerSchema);
  if (!body.ok) {
    return body.response;
  }
  const result = await answer(withTestClock(getStudyContext(), request), body.data);
  return result.ok
    ? json({ ok: true, review: result.review, card: result.card })
    : errorResponse(result);
};
