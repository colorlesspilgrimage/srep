// Contract: turn joined card rows into a browse page. Pure. No I/O.
// frontText is the first field with tags removed, cut at 80 code points.
// Templates are not rendered. A null deck id becomes an empty string.

import { stripTags } from '#lib/server/domain/core/text.js';
import type { BrowsePage, BrowseRawRow, BrowseRow } from '#lib/server/browse/types.js';

const FRONT_LIMIT = 80;

export function frontTextOf(fields: readonly string[] | null | undefined): string {
  const stripped = stripTags(fields?.[0] ?? '');
  const chars = [...stripped];
  if (chars.length <= FRONT_LIMIT) return stripped;
  return chars.slice(0, FRONT_LIMIT).join('');
}

export function tagsByNote(
  ids: readonly string[],
  rows: readonly { noteId: string; tag: string }[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const id of ids) map.set(id, []);
  for (const row of rows) {
    const list = map.get(row.noteId);
    if (list !== undefined) list.push(row.tag);
  }
  for (const list of map.values()) list.sort(byCodeUnit);
  return map;
}

function byCodeUnit(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function toRow(row: BrowseRawRow, tags: ReadonlyMap<string, readonly string[]>): BrowseRow {
  return {
    cardId: row.cardId,
    noteId: row.noteId,
    deckId: row.deckId ?? '',
    deckPath: row.deckPath,
    state: row.state,
    due: row.due,
    lapses: row.lapses,
    frontText: frontTextOf(row.fields),
    tags: [...(tags.get(row.noteId) ?? [])],
  };
}

export function toBrowsePage(
  rows: readonly BrowseRawRow[],
  limit: number,
  tags: ReadonlyMap<string, readonly string[]>,
): BrowsePage {
  const more = rows.length > limit;
  const kept = more ? rows.slice(0, limit) : [...rows];
  const last = kept[kept.length - 1];
  return {
    rows: kept.map((row) => toRow(row, tags)),
    nextCursor: more && last !== undefined ? last.cardId : null,
  };
}
