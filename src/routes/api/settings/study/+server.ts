import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { errorResponse, readJson } from '#lib/server/auth/http.js';
import { studySettingsSchema } from '#lib/server/study/core/validation.js';
import { getStudyContext } from '#lib/server/study/context.js';
import { getSettings, updateSettings } from '#lib/server/study/study-settings.js';

// The study day: { rolloverHour 0..23, timezone (IANA name) }.
export const GET: RequestHandler = async () => {
  const result = await getSettings(getStudyContext());
  return result.ok ? json({ settings: result.settings }) : errorResponse(result);
};

export const PUT: RequestHandler = async ({ request }) => {
  const body = await readJson(request, studySettingsSchema);
  if (!body.ok) {
    return body.response;
  }
  const result = await updateSettings(getStudyContext(), body.data);
  return result.ok ? json({ settings: result.settings }) : errorResponse(result);
};
