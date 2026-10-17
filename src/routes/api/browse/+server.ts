// Contract: GET /api/browse?q=&limit=&cursor=.
// Calls searchBrowse. Does not write.
// Success: JSON { rows, nextCursor }. A bad query is 400 bad_query.
// A guest is rejected by the auth hook before this handler runs.
// The body is per session. A cache must not store it (CWE-525).

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchBrowse } from '#lib/server/browse/search.js';
import { privatePageHeaders } from '#lib/server/http/private-page.js';

function reply(body: unknown, status = 200): Response {
  return json(body, { status, headers: privatePageHeaders() });
}

export const GET: RequestHandler = async ({ url }) => {
  const result = await searchBrowse({
    q: url.searchParams.get('q'),
    limit: url.searchParams.get('limit'),
    cursor: url.searchParams.get('cursor'),
  });
  if (!result.ok) return reply({ error: result.error }, result.status);
  return reply({ rows: result.rows, nextCursor: result.nextCursor });
};
