import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { badRequest, errorResponse } from '#lib/server/auth/http.js';
import { studyNextQuerySchema } from '#lib/server/study/core/validation.js';
import { getStudyContext } from '#lib/server/study/context.js';
import { withTestClock } from '#lib/server/study/request-clock.js';
import { getNext } from '#lib/server/study/study-next.js';

export const GET: RequestHandler = async (event) => {
  const query = studyNextQuerySchema.safeParse(Object.fromEntries(event.url.searchParams));
  if (!query.success) {
    return badRequest();
  }
  const deps = withTestClock(getStudyContext(), event.request);
  const result = await getNext(deps, query.data);
  return result.ok ? json(result.reply) : errorResponse(result);
};
