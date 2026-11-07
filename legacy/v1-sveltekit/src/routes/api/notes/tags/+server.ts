import type { RequestHandler } from './$types';
import { noteTagsBody, replaceNoteTagsBulk, runBulkPost } from '#lib/server/browse/bulk.js';

export const POST: RequestHandler = ({ request }) =>
  runBulkPost(request, noteTagsBody, (data) =>
    replaceNoteTagsBulk(data.noteIds, data.add, data.remove),
  );
