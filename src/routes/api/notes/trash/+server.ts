// Contract: POST /api/notes/trash.
// Body: { noteIds }. One transaction. A missing id writes nothing.
// A guest is rejected by the auth hook before this handler runs.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readJson } from '#lib/server/auth/http.js';
import { noteTrashBody, trashNotesBulk } from '#lib/server/browse/bulk.js';
import { privatePageHeaders } from '#lib/server/http/private-page.js';

function reply(body: unknown, status: number): Response {
  return json(body, { status, headers: privatePageHeaders() });
}

export const POST: RequestHandler = async ({ request }) => {
  const body = await readJson(request, noteTrashBody);
  if (!body.ok) return body.response;
  const result = await trashNotesBulk(body.data.noteIds);
  if (!result.ok) return reply({ error: result.error }, result.status);
  return reply({ ok: true }, 200);
};
