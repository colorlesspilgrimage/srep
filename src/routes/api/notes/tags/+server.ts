// Contract: POST /api/notes/tags.
// Body: { noteIds, add, remove }. One transaction for every id.
// A guest is rejected by the auth hook before this handler runs.

import type { RequestHandler } from './$types';
import { noteTagsBody, replaceNoteTagsBulk, runBulkPost } from '#lib/server/browse/bulk.js';

export const POST: RequestHandler = ({ request }) =>
  runBulkPost(request, noteTagsBody, (data) =>
    replaceNoteTagsBulk(data.noteIds, data.add, data.remove),
  );
