// Contract: POST /api/notes/trash.
// Body: { noteIds }. One transaction. A missing id writes nothing.
// A guest is rejected by the auth hook before this handler runs.

import type { RequestHandler } from './$types';
import { noteTrashBody, runBulkPost, trashNotesBulk } from '#lib/server/browse/bulk.js';

export const POST: RequestHandler = ({ request }) =>
  runBulkPost(request, noteTrashBody, (data) => trashNotesBulk(data.noteIds));
