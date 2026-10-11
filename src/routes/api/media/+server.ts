import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { errorResponse } from '#lib/server/auth/http.js';
import { getDomainContext } from '#lib/server/domain/context.js';
import { readBytesLimited } from '#lib/server/domain/http.js';
import { storeMedia } from '#lib/server/domain/media.js';

// The body is the raw file. content-type is its type. x-filename is optional metadata.
export const POST: RequestHandler = async ({ request }) => {
  const deps = getDomainContext();
  const bytes = await readBytesLimited(request, deps.limits.mediaMaxBytes);
  if (bytes === null) {
    return json({ error: 'payload_too_large' }, { status: 413 });
  }
  const result = await storeMedia(deps, {
    bytes,
    declaredMime: request.headers.get('content-type') ?? '',
    originalName: request.headers.get('x-filename') ?? '',
  });
  if (!result.ok) {
    return errorResponse(result);
  }
  return json({ media: result.media }, { status: result.media.created ? 201 : 200 });
};
