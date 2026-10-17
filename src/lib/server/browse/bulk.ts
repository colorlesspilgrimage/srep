// Contract: HTTP services for bulk note tags and bulk note trash.
// The body schemas are strict. noteIds length is 1 to 100.
// Each id is a UUID. A bad id is 400 and is not a SQL parameter (CWE-89).
// replace and trash each run in one transaction.

import { z } from 'zod';
import { fail, type Result } from '#lib/server/auth/deps.js';
import { getDb } from '#lib/server/db/index.js';
import { getDomainContext } from '#lib/server/domain/context.js';
import {
  replaceNoteTags as replaceNoteTagsPg,
  trashNotes as trashNotesPg,
} from '#lib/server/domain/store/note-bulk.pg.js';
import { MAX_BULK_NOTES, type BulkCode } from '#lib/server/domain/store/note-bulk-plan.js';
import {
  replaceNoteTags as replaceNoteTagsSqlite,
  trashNotes as trashNotesSqlite,
} from '#lib/server/domain/store/note-bulk.sqlite.js';

const noNul = (value: string): boolean => !value.includes('\u0000');
const tagText = z.string().max(200).refine(noNul);
const noteIds = z.array(z.uuid()).min(1).max(MAX_BULK_NOTES);

export const noteTagsBody = z
  .object({
    noteIds,
    add: z.array(tagText).max(1000),
    remove: z.array(tagText).max(1000),
  })
  .strict();

export const noteTrashBody = z.object({ noteIds }).strict();

function toResult(code: BulkCode): Result<object> {
  if (code === 'ok') return { ok: true };
  if (code === 'not_found') return fail(404, 'not_found');
  return fail(400, 'bad_request');
}

export async function replaceNoteTagsBulk(
  ids: readonly string[],
  add: readonly string[],
  remove: readonly string[],
): Promise<Result<object>> {
  const now = getDomainContext().now();
  const handle = getDb();
  const code =
    handle.dialect === 'sqlite'
      ? replaceNoteTagsSqlite(handle.db, ids, add, remove, now)
      : await replaceNoteTagsPg(handle.db, ids, add, remove, now);
  return toResult(code);
}

export async function trashNotesBulk(ids: readonly string[]): Promise<Result<object>> {
  const now = getDomainContext().now();
  const handle = getDb();
  const code =
    handle.dialect === 'sqlite'
      ? trashNotesSqlite(handle.db, ids, now)
      : await trashNotesPg(handle.db, ids, now);
  return toResult(code);
}
