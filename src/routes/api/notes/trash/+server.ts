// Contract: GET lists trashed notes. POST bulk-trashes note ids.
// Body: { noteIds }. One transaction. A missing id writes nothing.
// A guest is rejected by the auth hook before this handler runs.

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
