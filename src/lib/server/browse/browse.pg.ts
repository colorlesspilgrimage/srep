// Contract: Postgres card search for browse.
// Same filter as the SQLite search. User text is a bound parameter (CWE-89).
// The field match uses jsonb_array_elements_text.
// This file does not open a connection. The caller passes db.

import { asc, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { tagsByNote, toBrowsePage } from '#lib/server/browse/browse-page.js';
import { browseWhere, type BrowseColumns } from '#lib/server/browse/browse-where.js';
import type { BrowsePage, BrowseQuery, BrowseRawRow } from '#lib/server/browse/types.js';
import { card, deck, note, noteTag } from '#lib/server/db/schema/pg.js';

const columns: BrowseColumns = {
  cardId: card.id,
  noteId: card.noteId,
  state: card.state,
  due: card.due,
  lapses: card.lapses,
  fields: note.fields,
  noteDeleted: note.deletedAt,
  deckArchived: deck.archivedAt,
  deckPath: deck.path,
  tagNoteId: noteTag.noteId,
  tagValue: noteTag.tag,
  tagTable: noteTag,
};

const shape = {
  cardId: card.id,
  noteId: note.id,
  deckId: deck.id,
  deckPath: deck.path,
  state: card.state,
  due: card.due,
  lapses: card.lapses,
  fields: note.fields,
};

async function loadTags(
  db: PostgresJsDatabase,
  rows: readonly { noteId: string }[],
): Promise<Map<string, string[]>> {
  const ids = [...new Set(rows.map((row) => row.noteId))];
  if (ids.length === 0) return new Map();
  const tagRows = await db
    .select({ noteId: noteTag.noteId, tag: noteTag.tag })
    .from(noteTag)
    .where(inArray(noteTag.noteId, ids))
    .orderBy(asc(noteTag.tag));
  return tagsByNote(ids, tagRows);
}

export async function searchCards(
  db: PostgresJsDatabase,
  query: BrowseQuery,
  windowEndMs: number,
  limit: number,
  cursor: string | null,
): Promise<BrowsePage> {
  const where = browseWhere(columns, query, windowEndMs, cursor, 'pg');
  const rows = (await db
    .select(shape)
    .from(card)
    .innerJoin(note, eq(note.id, card.noteId))
    .innerJoin(deck, eq(deck.id, card.deckId))
    .where(where)
    .orderBy(asc(card.id))
    .limit(limit + 1)) satisfies BrowseRawRow[];
  return toBrowsePage(rows, limit, await loadTags(db, rows));
}
