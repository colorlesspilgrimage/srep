import type { RequestHandler } from './$types';
import { errorResponse } from '#lib/server/auth/http.js';
import { privateJson } from '#lib/server/http/private-page.js';
import { getTodayStats } from '#lib/server/stats/service.js';
import { getDb } from '#lib/server/db/index.js';
import { getStudyContext } from '#lib/server/study/context.js';

export const GET: RequestHandler = async () => {
  const result = await getTodayStats(getDb(), getStudyContext());
  return result.ok ? privateJson({ today: result.today }) : errorResponse(result);
};
