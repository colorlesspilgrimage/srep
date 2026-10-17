// Contract: map joined rows to a browse page. Pure. No I/O.
// frontText is plain text. The list does not render a template.

import { compareCodeUnit, groupNoteTags } from '#lib/server/domain/core/code-unit.js';
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
  const map = groupNoteTags(ids, rows);
  for (const list of map.values()) list.sort(compareCodeUnit);
  return map;
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
