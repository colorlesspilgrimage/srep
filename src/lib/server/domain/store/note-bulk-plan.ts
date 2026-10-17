// Contract: pure checks for bulk note tag replace and bulk trash.
// ids length is 1 to 100. Every id is a lower-case UUID. Duplicates collapse.
// A bad id returns null and must not be sent to SQL (CWE-89).
// planTagReplace returns null when normalizeTags rejects the result.

import { z } from 'zod';
import { compareCodeUnit, groupNoteTags } from '#lib/server/domain/core/code-unit.js';
import { normalizeTags } from '#lib/server/domain/core/tags.js';

export const MAX_BULK_NOTES = 100;

export type BulkCode = 'ok' | 'not_found' | 'bad_request';

export type NoteSnap = { id: string; tags: string[] };

type NoteIdRow = { id: string; deletedAt: number | null };

type TagRow = { noteId: string; tag: string };

export function bulkNoteIds(ids: readonly string[]): string[] | null {
  if (ids.length < 1 || ids.length > MAX_BULK_NOTES) return null;
  const unique: string[] = [];
  for (const id of ids) {
    const parsed = z.uuid().safeParse(id);
    if (!parsed.success) return null;
    const canonical = parsed.data.toLowerCase();
    if (!unique.includes(canonical)) unique.push(canonical);
  }
  unique.sort(compareCodeUnit);
  return unique;
}

export function planTagReplace(
  current: readonly string[],
  add: readonly string[],
  remove: readonly string[],
): string[] | null {
  const added = normalizeTags([...add]);
  const removed = normalizeTags([...remove]);
  if (added === null || removed === null) return null;
  const drop = new Set(removed);
  const merged = current.filter((tag) => !drop.has(tag)).concat(added);
  return normalizeTags(merged);
}

export function snapsFrom(
  ids: readonly string[],
  notes: readonly NoteIdRow[],
  tagRows: readonly TagRow[],
): NoteSnap[] | null {
  if (notes.length !== ids.length) return null;
  const deletedAt = new Map(notes.map((row) => [row.id, row.deletedAt]));
  for (const id of ids) {
    const deleted = deletedAt.get(id);
    if (deleted === undefined || deleted !== null) return null;
  }
  const tags = groupNoteTags(ids, tagRows);
  return ids.map((id) => ({ id, tags: [...(tags.get(id) ?? [])] }));
}

export function planAll(
  snaps: readonly NoteSnap[],
  add: readonly string[],
  remove: readonly string[],
): NoteSnap[] | null {
  const plans: NoteSnap[] = [];
  for (const snap of snaps) {
    const tags = planTagReplace(snap.tags, add, remove);
    if (tags === null) return null;
    plans.push({ id: snap.id, tags });
  }
  return plans;
}
