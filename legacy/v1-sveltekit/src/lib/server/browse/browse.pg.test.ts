import { PgDialect } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { describe, expect, it } from 'vitest';
import { searchCards } from '#lib/server/browse/browse.pg.js';
import { asciiLower, escapeLike } from '#lib/server/browse/like-escape.js';
import type { BrowseQuery } from '#lib/server/browse/types.js';

type Call = { name: string; args: unknown[] };

const hostile = `'; drop table note; --`;
const cursor = '123e4567-e89b-42d3-a456-426614174000';

function chain(rows: unknown[], calls: Call[]): Record<string, unknown> {
  const result = Promise.resolve(rows);
  const node: Record<string, unknown> = {};
  const rec =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push({ name, args });
      return node;
    };
  for (const name of ['from', 'innerJoin', 'where', 'orderBy', 'limit', 'set', 'values']) {
    node[name] = rec(name);
  }
  node.for = rec('for');
  node.then = (ok?: (value: unknown) => unknown, err?: (reason: unknown) => unknown) =>
    result.then(ok, err);
  return node;
}

function createStub(queue: unknown[][]): { db: PostgresJsDatabase; calls: Call[] } {
  const calls: Call[] = [];
  const db = {
    select(...args: unknown[]) {
      calls.push({ name: 'select', args });
      return chain(queue.shift() ?? [], calls);
    },
  };
  return { db: db as unknown as PostgresJsDatabase, calls };
}

describe('postgres browse search', () => {
  it('binds user text and does not put it in the SQL', async () => {
    const noteId = '00000000-0000-4000-8000-0000000000bb';
    const { db, calls } = createStub([
      [
        {
          cardId: '00000000-0000-4000-8000-0000000000aa',
          noteId,
          deckId: '00000000-0000-4000-8000-0000000000cc',
          deckPath: 'Spanish',
          state: 'new',
          due: 1,
          lapses: 0,
          fields: ['<b>GATO</b>'],
        },
      ],
      [{ noteId, tag: 'animals' }],
    ]);
    const query: BrowseQuery = {
      decks: [],
      tags: [hostile],
      is: [],
      props: [],
      texts: [hostile],
    };
    const page = await searchCards(db, query, 50, 10, cursor);
    expect(page.rows[0]).toMatchObject({ frontText: 'GATO', tags: ['animals'] });
    expect(page.nextCursor).toBeNull();
    const where = calls.find((call) => call.name === 'where');
    if (where === undefined) throw new Error('missing where');
    const compiled = new PgDialect().sqlToQuery(where.args[0] as never);
    expect(compiled.sql.includes(hostile)).toBe(false);
    expect(compiled.sql.toLowerCase()).toContain('escape');
    expect(compiled.params).toContain(hostile);
    expect(compiled.params).toContain(`%${escapeLike(asciiLower(hostile))}%`);
    expect(compiled.params).toContain(cursor);
    const limit = calls.find((call) => call.name === 'limit');
    expect(limit?.args).toEqual([11]);
  });

  it('does not read tags when the page is empty', async () => {
    const { db, calls } = createStub([[]]);
    const page = await searchCards(
      db,
      { decks: [], tags: [], is: [], props: [], texts: [] },
      1,
      10,
      null,
    );
    expect(page).toEqual({ rows: [], nextCursor: null });
    expect(calls.filter((call) => call.name === 'select')).toHaveLength(1);
  });
});
