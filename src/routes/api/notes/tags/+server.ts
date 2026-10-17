// Contract: POST /api/notes/tags.
// Body: { noteIds, add, remove }. One transaction for every id.
// A guest is rejected by the auth hook before this handler runs.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readJson } from '#lib/server/auth/http.js';
import { noteTagsBody, replaceNoteTagsBulk } from '#lib/server/browse/bulk.js';
import { privatePageHeaders } from '#lib/server/http/private-page.js';

function reply(body: unknown, status: number): Response {
  return json(body, { status, headers: privatePageHeaders() });
}

export const POST: RequestHandler = async ({ request }) => {
  const body = await readJson(request, noteTagsBody);
  if (!body.ok) return body.response;
  const result = await replaceNoteTagsBulk(body.data.noteIds, body.data.add, body.data.remove);
  if (!result.ok) return reply({ error: result.error }, result.status);
  return reply({ ok: true }, 200);
};
