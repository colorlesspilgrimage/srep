// Contract: SQLite bulk tag replace and bulk trash.
// One immediate transaction. The write lock starts before the read (CWE-362).
// A missing or trashed id writes nothing.
// User ids are lower-case UUIDs before they reach SQL (CWE-89).
// A second connection waits. It does not use FOR UPDATE.

import { eq, inArray } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  bulkNoteIds,
  planAll,
  snapsFrom,
  type BulkCode,
  type NoteSnap,
} from '#lib/server/domain/store/note-bulk-plan.js';
import { note, noteTag } from '#lib/server/db/schema/sqlite.js';

type Exec = Pick<BetterSQLite3Database, 'select' | 'insert' | 'update' | 'delete'>;

function loadSnaps(tx: Exec, ids: string[]): NoteSnap[] | null {
  const notes = tx
    .select({ id: note.id, deletedAt: note.deletedAt })
    .from(note)
    .where(inArray(note.id, ids))
    .all();
  const tagRows = tx
    .select({ noteId: noteTag.noteId, tag: noteTag.tag })
    .from(noteTag)
    .where(inArray(noteTag.noteId, ids))
    .all();
  return snapsFrom(ids, notes, tagRows);
}

function writeTags(tx: Exec, id: string, tags: string[], now: number): void {
  tx.delete(noteTag).where(eq(noteTag.noteId, id)).run();
  if (tags.length > 0) {
    tx.insert(noteTag)
      .values(tags.map((tag) => ({ noteId: id, tag })))
      .run();
  }
  tx.update(note).set({ updatedAt: now }).where(eq(note.id, id)).run();
}

export function replaceNoteTags(
  db: BetterSQLite3Database,
  ids: readonly string[],
  add: readonly string[],
  remove: readonly string[],
  now: number,
): BulkCode {
  const unique = bulkNoteIds(ids);
  if (unique === null) return 'bad_request';
  return db.transaction(
    (tx) => {
      const snaps = loadSnaps(tx, unique);
      if (snaps === null) return 'not_found';
      const plans = planAll(snaps, add, remove);
      if (plans === null) return 'bad_request';
      for (const plan of plans) writeTags(tx, plan.id, plan.tags, now);
      return 'ok';
    },
    { behavior: 'immediate' },
  );
}

export function trashNotes(
  db: BetterSQLite3Database,
  ids: readonly string[],
  now: number,
): BulkCode {
  const unique = bulkNoteIds(ids);
  if (unique === null) return 'bad_request';
  return db.transaction(
    (tx) => {
      const snaps = loadSnaps(tx, unique);
      if (snaps === null) return 'not_found';
      for (const snap of snaps) {
        tx.update(note).set({ deletedAt: now, updatedAt: now }).where(eq(note.id, snap.id)).run();
      }
      return 'ok';
    },
    { behavior: 'immediate' },
  );
}
