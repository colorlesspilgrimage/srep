import type { RequestHandler } from './$types';
import { errorResponse, readJson } from '#lib/server/auth/http.js';
import { z } from 'zod';
import { privateJson } from '#lib/server/http/private-page.js';
import { optimizerPreview } from '#lib/server/stats/optimizer-service.js';
import { getDb } from '#lib/server/db/index.js';
import { getStudyContext } from '#lib/server/study/context.js';

const bodySchema = z.object({ presetId: z.string().uuid() });

export const POST: RequestHandler = async ({ request }) => {
  const body = await readJson(request, bodySchema);
  if (!body.ok) {
    return body.response;
  }
  const result = await optimizerPreview(getDb(), getStudyContext(), body.data.presetId);
  if (!result.ok) {
    return errorResponse(result);
  }
  return privateJson({
    reviewCount: result.reviewCount,
    current: result.current,
    proposed: result.proposed,
    retention: result.retention,
    previewToken: result.previewToken,
  });
};
