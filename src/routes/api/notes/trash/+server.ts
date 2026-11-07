import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { errorResponse } from '#lib/server/auth/http.js';
import { noteTrashBody, runBulkPost, trashNotesBulk } from '#lib/server/browse/bulk.js';
import { getDomainContext } from '#lib/server/domain/context.js';
import { listTrash } from '#lib/server/domain/notes.js';

export const GET: RequestHandler = async () => {
  const result = await listTrash(getDomainContext());
  return result.ok ? json({ notes: result.notes }) : errorResponse(result);
};

export const POST: RequestHandler = ({ request }) =>
  runBulkPost(request, noteTrashBody, (data) => trashNotesBulk(data.noteIds));
