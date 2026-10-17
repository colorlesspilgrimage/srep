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

function withPrivate(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(privatePageHeaders())) headers.set(name, value);
  return new Response(response.body, { status: response.status, headers });
}

export const POST: RequestHandler = async ({ request }) => {
  const body = await readJson(request, noteTagsBody);
  if (!body.ok) return withPrivate(body.response);
  const result = await replaceNoteTagsBulk(body.data.noteIds, body.data.add, body.data.remove);
  if (!result.ok) return reply({ error: result.error }, result.status);
  return reply({ ok: true }, 200);
};
