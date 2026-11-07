import type { RequestHandler } from './$types';
import { errorResponse } from '#lib/server/auth/http.js';
import { privateJson } from '#lib/server/http/private-page.js';
import { getForecast } from '#lib/server/stats/service.js';
import { getDb } from '#lib/server/db/index.js';
import { getStudyContext } from '#lib/server/study/context.js';

export const GET: RequestHandler = async ({ url }) => {
  const result = await getForecast(getDb(), getStudyContext(), url.searchParams.get('days'));
  return result.ok ? privateJson({ days: result.days }) : errorResponse(result);
};
