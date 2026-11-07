import type { RequestHandler } from './$types';
import { errorResponse } from '#lib/server/auth/http.js';
import { privateJson } from '#lib/server/http/private-page.js';
import { getRetention } from '#lib/server/stats/service.js';
import { getDb } from '#lib/server/db/index.js';
import { getStudyContext } from '#lib/server/study/context.js';

export const GET: RequestHandler = async ({ url }) => {
  const presetId = url.searchParams.get('presetId');
  const result = await getRetention(getDb(), getStudyContext(), presetId);
  return result.ok ? privateJson({ retention: result.retention }) : errorResponse(result);
};
