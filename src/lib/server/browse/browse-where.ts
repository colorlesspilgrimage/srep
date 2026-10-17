// Contract: build the browse WHERE clause. Pure. No I/O.
// Every user string is a bound parameter (CWE-89).
// LIKE uses ESCAPE '\'. Deck children match path plus '::'.
// is:due is state review and due before the study-day end.
// Free text uses asciiLower on the pattern.
// SQLite lower() folds A to Z. Postgres translate() folds those same letters.
// Postgres lower() also folds letters such as Ä, so the pg clause does not use it.

import { type AnyColumn, type SQL, type Table, sql } from 'drizzle-orm';
import { asciiLower, escapeLike } from '#lib/server/browse/like-escape.js';
import type { BrowseIs, BrowseProp, BrowseQuery } from '#lib/server/browse/types.js';

export type BrowseDialect = 'sqlite' | 'pg';

export type BrowseColumns = {
  cardId: AnyColumn;
  noteId: AnyColumn;
  state: AnyColumn;
  due: AnyColumn;
  lapses: AnyColumn;
  fields: AnyColumn;
  noteDeleted: AnyColumn;
  deckArchived: AnyColumn;
  deckPath: AnyColumn;
  tagNoteId: AnyColumn;
  tagValue: AnyColumn;
  tagTable: Table;
};

export function combineAnd(parts: readonly SQL[]): SQL {
  const first = parts[0];
  if (first === undefined) return sql`1 = 1`;
  let current = sql`(${first})`;
  for (const part of parts.slice(1)) current = sql`${current} and (${part})`;
  return current;
}

// '=' is case-sensitive. LIKE is not, on SQLite, so a child uses substr.
// '%' and '_' in a deck path stay literal. They are not wildcards.
function deckClause(pathCol: AnyColumn, path: string): SQL {
  return sql`(${pathCol} = ${path} or substr(${pathCol}, 1, length(${path}) + 2) = ${path} || '::')`;
}

function tagClause(cols: BrowseColumns, tag: string): SQL {
  return sql`exists (select 1 from ${cols.tagTable} where ${cols.tagNoteId} = ${cols.noteId} and ${cols.tagValue} = ${tag})`;
}

function textClause(fields: AnyColumn, text: string, dialect: BrowseDialect): SQL {
  const pattern = `%${escapeLike(asciiLower(text))}%`;
  if (dialect === 'sqlite') {
    return sql`exists (select 1 from json_each(${fields}) as field where lower(field.value) like ${pattern} escape '\\')`;
  }
  return sql`exists (select 1 from jsonb_array_elements_text(${fields}) as field(value) where translate(field.value, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') like ${pattern} escape '\\')`;
}

function isClause(cols: BrowseColumns, flag: BrowseIs, windowEndMs: number): SQL {
  if (flag === 'new') return sql`${cols.state} = 'new'`;
  if (flag === 'suspended') return sql`${cols.state} = 'suspended'`;
  return sql`${cols.state} = 'review' and ${cols.due} < ${windowEndMs}`;
}

function propClause(lapses: AnyColumn, prop: BrowseProp): SQL {
  const value = prop.value;
  if (prop.op === '>') return sql`${lapses} > ${value}`;
  if (prop.op === '>=') return sql`${lapses} >= ${value}`;
  if (prop.op === '<') return sql`${lapses} < ${value}`;
  if (prop.op === '<=') return sql`${lapses} <= ${value}`;
  return sql`${lapses} = ${value}`;
}

export function browseWhere(
  cols: BrowseColumns,
  query: BrowseQuery,
  windowEndMs: number,
  cursor: string | null,
  dialect: BrowseDialect,
): SQL {
  const parts: SQL[] = [sql`${cols.noteDeleted} is null`, sql`${cols.deckArchived} is null`];
  if (cursor !== null) parts.push(sql`${cols.cardId} > ${cursor}`);
  for (const path of query.decks) parts.push(deckClause(cols.deckPath, path));
  for (const tag of query.tags) parts.push(tagClause(cols, tag));
  for (const flag of query.is) parts.push(isClause(cols, flag, windowEndMs));
  for (const prop of query.props) parts.push(propClause(cols.lapses, prop));
  for (const text of query.texts) parts.push(textClause(cols.fields, text, dialect));
  return combineAnd(parts);
}
