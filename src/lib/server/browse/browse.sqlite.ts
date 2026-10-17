// Contract: SQLite card search for browse. The caller passes db.
// User text is bound. LIKE uses ESCAPE '\' (CWE-89).

import { asc, eq, inArray } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { tagsByNote, toBrowsePage } from '#lib/server/browse/browse-page.js';
import { browseColumns, browseWhere } from '#lib/server/browse/browse-where.js';
import type { BrowsePage, BrowseQuery, BrowseRawRow } from '#lib/server/browse/types.js';
import { card, deck, note, noteTag } from '#lib/server/db/schema/sqlite.js';

const columns = browseColumns({ card, note, deck, noteTag });

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

function loadTags(
  db: BetterSQLite3Database,
  rows: readonly { noteId: string }[],
): Map<string, string[]> {
  const ids = [...new Set(rows.map((row) => row.noteId))];
  if (ids.length === 0) return new Map();
  const tagRows = db
    .select({ noteId: noteTag.noteId, tag: noteTag.tag })
    .from(noteTag)
    .where(inArray(noteTag.noteId, ids))
    .orderBy(asc(noteTag.tag))
    .all();
  return tagsByNote(ids, tagRows);
}

export function searchCards(
  db: BetterSQLite3Database,
  query: BrowseQuery,
  windowEndMs: number,
  limit: number,
  cursor: string | null,
): BrowsePage {
  const where = browseWhere(columns, query, windowEndMs, cursor, 'sqlite');
  const rows = db
    .select(shape)
    .from(card)
    .innerJoin(note, eq(note.id, card.noteId))
    .innerJoin(deck, eq(deck.id, card.deckId))
    .where(where)
    .orderBy(asc(card.id))
    .limit(limit + 1)
    .all() satisfies BrowseRawRow[];
  return toBrowsePage(rows, limit, loadTags(db, rows));
}
