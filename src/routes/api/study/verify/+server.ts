import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { errorResponse } from '#lib/server/auth/http.js';
import { getStudyContext } from '#lib/server/study/context.js';
import { verifyReplay } from '#lib/server/study/replay-service.js';

// Replays the whole review log and lists the cards whose cache differs.
export const GET: RequestHandler = async () => {
  const result = await verifyReplay(getStudyContext());
  return result.ok ? json(result.report) : errorResponse(result);
};
