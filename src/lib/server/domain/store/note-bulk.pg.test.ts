import { PgDialect } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { describe, expect, it } from 'vitest';
import { note } from '#lib/server/db/schema/pg.js';
import { replaceNoteTags, trashNotes } from '#lib/server/domain/store/note-bulk.pg.js';

type Call = { name: string; args: unknown[] };

const a = '00000000-0000-4000-8000-000000000010';
const b = '00000000-0000-4000-8000-000000000020';

function chain(rows: unknown[], calls: Call[]): Record<string, unknown> {
  const result = Promise.resolve(rows);
  const node: Record<string, unknown> = {};
  const rec =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push({ name, args });
      return node;
    };
  for (const name of ['from', 'where', 'orderBy', 'set', 'values']) node[name] = rec(name);
  node.for = rec('for');
  node.then = (ok?: (value: unknown) => unknown, err?: (reason: unknown) => unknown) =>
    result.then(ok, err);
  return node;
}

function createStub(queue: unknown[][]) {
  const calls: Call[] = [];
  let transactions = 0;
  const db = {
    select(...args: unknown[]) {
      calls.push({ name: 'select', args });
      return chain(queue.shift() ?? [], calls);
    },
    insert(...args: unknown[]) {
      calls.push({ name: 'insert', args });
      return chain([], calls);
    },
    update(...args: unknown[]) {
      calls.push({ name: 'update', args });
      return chain([], calls);
    },
    delete(...args: unknown[]) {
      calls.push({ name: 'delete', args });
      return chain([], calls);
    },
    transaction(fn: (tx: unknown) => Promise<unknown>) {
      transactions += 1;
      return fn(db);
    },
  };
  return {
    db: db as unknown as PostgresJsDatabase,
    calls,
    transactions: () => transactions,
  };
}

function whereParams(calls: Call[]): unknown[] {
  const where = calls.find((call) => call.name === 'where');
  if (where === undefined) throw new Error('missing where');
  return new PgDialect().sqlToQuery(where.args[0] as never).params;
}

describe('postgres note bulk', () => {
  it('locks rows in id order and stores a tag as a value', async () => {
    const { db, calls } = createStub([
      [{ id: a }, { id: b }],
      [
        { id: a, deletedAt: null },
        { id: b, deletedAt: null },
      ],
      [{ noteId: a, tag: 'old' }],
    ]);
    const code = await replaceNoteTags(db, [b, a], [`a';drop`], [], 9);
    expect(code).toBe('ok');
    expect(calls.find((call) => call.name === 'select')?.args[0]).toEqual({ id: note.id });
    expect(calls.some((call) => call.name === 'for' && call.args[0] === 'update')).toBe(true);
    expect(whereParams(calls)).toEqual([a, b]);
    const order = calls.find((call) => call.name === 'orderBy');
    if (order === undefined) throw new Error('missing order');
    expect(new PgDialect().sqlToQuery(order.args[0] as never).sql.toLowerCase()).toContain('asc');
    const values = calls.find((call) => call.name === 'values');
    expect(values?.args[0]).toEqual([
      { noteId: a, tag: `a';drop` },
      { noteId: a, tag: 'old' },
    ]);
  });

  it('does not write when a tag is bad or a row is missing', async () => {
    const missing = createStub([[]]);
    expect(await replaceNoteTags(missing.db, [a], ['plants'], [], 1)).toBe('not_found');
    expect(missing.calls.some((call) => call.name === 'insert')).toBe(false);

    const bad = createStub([
      [{ id: a }],
      [{ id: a, deletedAt: null }],
      [{ noteId: a, tag: 'old' }],
    ]);
    expect(await replaceNoteTags(bad.db, [a], ['bad tag'], [], 1)).toBe('bad_request');
    expect(bad.calls.some((call) => call.name === 'delete')).toBe(false);

    const empty = createStub([
      [{ id: a }],
      [{ id: a, deletedAt: null }],
      [{ noteId: a, tag: 'old' }],
    ]);
    expect(await replaceNoteTags(empty.db, [a], [], ['old'], 4)).toBe('ok');
    expect(empty.calls.some((call) => call.name === 'insert')).toBe(false);
    expect(empty.calls.some((call) => call.name === 'delete')).toBe(true);
  });

  it('trashes locked rows and skips a bad id', async () => {
    const stub = createStub([[{ id: a }], [{ id: a, deletedAt: null }], []]);
    expect(await trashNotes(stub.db, [a], 8)).toBe('ok');
    expect(stub.calls.some((call) => call.name === 'for' && call.args[0] === 'update')).toBe(true);
    const set = stub.calls.find((call) => call.name === 'set');
    expect(set?.args[0]).toEqual({ deletedAt: 8, updatedAt: 8 });

    const trashed = createStub([[{ id: a }], [{ id: a, deletedAt: 3 }], []]);
    expect(await trashNotes(trashed.db, [a], 9)).toBe('not_found');
    expect(trashed.calls.some((call) => call.name === 'update')).toBe(false);

    const hostile = createStub([]);
    expect(await replaceNoteTags(hostile.db, [`'; drop table note; --`], [], [], 1)).toBe(
      'bad_request',
    );
    expect(hostile.transactions()).toBe(0);
    expect(await trashNotes(hostile.db, [], 1)).toBe('bad_request');
    expect(hostile.transactions()).toBe(0);
  });
});
