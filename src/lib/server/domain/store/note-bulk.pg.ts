// Contract: Postgres bulk tag replace and bulk trash.
// One transaction. FOR UPDATE locks note rows ordered by id (CWE-362).
// The lock runs before the read. A missing or trashed id writes nothing.
// User ids are UUIDs before they reach SQL (CWE-89).

import { asc, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  bulkNoteIds,
  planAll,
  snapsFrom,
  type BulkCode,
  type NoteSnap,
} from '#lib/server/domain/store/note-bulk-plan.js';
import { note, noteTag } from '#lib/server/db/schema/pg.js';

type Exec = Pick<PostgresJsDatabase, 'select' | 'insert' | 'update' | 'delete'>;

async function loadSnaps(tx: Exec, ids: string[]): Promise<NoteSnap[] | null> {
  const locked = await tx
    .select({ id: note.id })
    .from(note)
    .where(inArray(note.id, ids))
    .orderBy(asc(note.id))
    .for('update');
  if (locked.length !== ids.length) return null;
  const notes = await tx
    .select({ id: note.id, deletedAt: note.deletedAt })
    .from(note)
    .where(inArray(note.id, ids));
  const tagRows = await tx
    .select({ noteId: noteTag.noteId, tag: noteTag.tag })
    .from(noteTag)
    .where(inArray(noteTag.noteId, ids));
  return snapsFrom(ids, notes, tagRows);
}

async function writeTags(tx: Exec, id: string, tags: string[], now: number): Promise<void> {
  await tx.delete(noteTag).where(eq(noteTag.noteId, id));
  if (tags.length > 0) {
    await tx.insert(noteTag).values(tags.map((tag) => ({ noteId: id, tag })));
  }
  await tx.update(note).set({ updatedAt: now }).where(eq(note.id, id));
}

export async function replaceNoteTags(
  db: PostgresJsDatabase,
  ids: readonly string[],
  add: readonly string[],
  remove: readonly string[],
  now: number,
): Promise<BulkCode> {
  const unique = bulkNoteIds(ids);
  if (unique === null) return 'bad_request';
  return db.transaction(async (tx) => {
    const snaps = await loadSnaps(tx, unique);
    if (snaps === null) return 'not_found';
    const plans = planAll(snaps, add, remove);
    if (plans === null) return 'bad_request';
    for (const plan of plans) await writeTags(tx, plan.id, plan.tags, now);
    return 'ok';
  });
}

export async function trashNotes(
  db: PostgresJsDatabase,
  ids: readonly string[],
  now: number,
): Promise<BulkCode> {
  const unique = bulkNoteIds(ids);
  if (unique === null) return 'bad_request';
  return db.transaction(async (tx) => {
    const snaps = await loadSnaps(tx, unique);
    if (snaps === null) return 'not_found';
    for (const snap of snaps) {
      await tx.update(note).set({ deletedAt: now, updatedAt: now }).where(eq(note.id, snap.id));
    }
    return 'ok';
  });
}
