import type { RequestHandler } from './$types';
import { searchBrowse } from '#lib/server/browse/search.js';
import { privateJson } from '#lib/server/http/private-page.js';

export const GET: RequestHandler = async ({ url }) => {
  const result = await searchBrowse({
    q: url.searchParams.get('q'),
    limit: url.searchParams.get('limit'),
    cursor: url.searchParams.get('cursor'),
  });
  if (!result.ok) return privateJson({ error: result.error }, result.status);
  return privateJson({ rows: result.rows, nextCursor: result.nextCursor });
};
