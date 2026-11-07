import type { RequestHandler } from './$types';
import { errorResponse } from '#lib/server/auth/http.js';
import { getDomainContext } from '#lib/server/domain/context.js';
import { readMedia } from '#lib/server/domain/media.js';

export const GET: RequestHandler = async ({ params }) => {
  const result = await readMedia(getDomainContext(), params.sha);
  if (!result.ok) {
    return errorResponse(result);
  }
  return new Response(new Uint8Array(result.bytes), {
    headers: {
      'content-type': result.media.mime,
      'content-length': String(result.bytes.length),
      'x-content-type-options': 'nosniff',
      'content-security-policy': "sandbox; default-src 'none'",
      'content-disposition': 'inline',
      'cache-control': 'private, max-age=31536000, immutable',
    },
  });
};
