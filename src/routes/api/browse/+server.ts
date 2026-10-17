// Contract: GET /api/browse?q=&limit=&cursor=. Does not write.
// Success: JSON { rows, nextCursor }. A bad query is 400 bad_query.
// A guest is rejected by the auth hook before this handler runs.
// The body is per session. A cache must not store it (CWE-525).

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
