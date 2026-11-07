import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { browseWhere, combineAnd, type BrowseColumns } from '#lib/server/browse/browse-where.js';
import { asciiLower, escapeLike } from '#lib/server/browse/like-escape.js';
import type { BrowseQuery } from '#lib/server/browse/types.js';
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

const hostile = `'; drop table note; --`;
const cursor = '123e4567-e89b-42d3-a456-426614174000';

function sample(): BrowseQuery {
  return {
    decks: ['%_'],
    tags: [hostile],
    is: ['due', 'new', 'suspended'],
    props: [
      { op: '>', value: 3 },
      { op: '>=', value: 3 },
      { op: '<', value: 3 },
      { op: '<=', value: 3 },
      { op: '=', value: 3 },
    ],
    texts: [hostile],
  };
}

describe('browseWhere', () => {
  it('binds user text and does not put it in the SQL string', () => {
    const compiled = new PgDialect().sqlToQuery(browseWhere(columns, sample(), 99, cursor, 'pg'));
    expect(compiled.sql.includes(hostile)).toBe(false);
    expect(compiled.sql.toLowerCase()).toContain('jsonb_array_elements_text');
    expect(compiled.sql.toLowerCase()).toContain('escape');
    expect(compiled.params).toContain(hostile);
    expect(compiled.params).toContain(`%${escapeLike(asciiLower(hostile))}%`);
    expect(compiled.params).toContain('%_');
    expect(compiled.sql.toLowerCase()).toContain('substr');
    expect(compiled.params).toContain(cursor);
  });

  it('uses json_each for sqlite text', () => {
    const compiled = new PgDialect().sqlToQuery(
      browseWhere(columns, { ...sample(), texts: ['gato'] }, 99, null, 'sqlite'),
    );
    expect(compiled.sql.toLowerCase()).toContain('json_each');
    expect(compiled.sql.toLowerCase()).not.toContain('jsonb_array_elements_text');
  });
});

describe('browseWhere escape and fold', () => {
  it('uses a one-character escape and an ASCII fold on postgres', () => {
    const pg = new PgDialect().sqlToQuery(
      browseWhere(columns, { ...sample(), texts: ['\\', '%', '_'] }, 1, null, 'pg'),
    );
    expect(pg.sql).toContain("escape '\\'");
    expect(pg.sql.toLowerCase()).toContain('translate(');
    expect(pg.sql.toLowerCase()).not.toContain('lower(');
    expect(pg.params).toContain(`%${escapeLike('\\')}%`);
    expect(pg.params).toContain(`%${escapeLike('%')}%`);
    expect(pg.params).toContain(`%${escapeLike('_')}%`);
    const sqlite = new PgDialect().sqlToQuery(
      browseWhere(
        columns,
        { decks: [], tags: [], is: [], props: [], texts: ['\\'] },
        1,
        null,
        'sqlite',
      ),
    );
    expect(sqlite.sql).toContain("escape '\\'");
    expect(sqlite.sql.toLowerCase()).toContain('lower(');
    expect(sqlite.sql.toLowerCase()).toContain('json_each');
  });
});

describe('combineAnd', () => {
  it('returns a true condition when there are no parts', () => {
    const compiled = new PgDialect().sqlToQuery(combineAnd([]));
    expect(compiled.sql).toBe('1 = 1');
  });
});
