import type { RequestHandler } from './$types';
import { errorResponse } from '#lib/server/auth/http.js';
import { privateJson } from '#lib/server/http/private-page.js';
import { getStreak } from '#lib/server/stats/service.js';
import { getDb } from '#lib/server/db/index.js';
import { getStudyContext } from '#lib/server/study/context.js';

export const GET: RequestHandler = async () => {
  const result = await getStreak(getDb(), getStudyContext());
  return result.ok ? privateJson({ streak: result.streak }) : errorResponse(result);
};
