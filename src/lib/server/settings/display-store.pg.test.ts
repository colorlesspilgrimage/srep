import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { describe, expect, it } from 'vitest';
import { appSettings } from '#lib/server/db/schema/pg.js';
import { DISPLAY_SETTINGS_KEY } from '#lib/server/settings/display-key.js';
import { createPgDisplayStore } from '#lib/server/settings/display-store.pg.js';

// Contract: the Postgres display store with a stub database. No server is used.

type Call = { name: string; arg: unknown };

type StubRow = { value: unknown };

const VALUE = {
  fontSize: 18,
  reducedMotion: true,
  scanline: false,
  cursorBlink: true,
};

function createStub(rows: StubRow[]): { db: PostgresJsDatabase; calls: Call[] } {
  const calls: Call[] = [];
  const db = {
    select(shape: unknown) {
      calls.push({ name: 'select', arg: shape });
      return {
        from(table: unknown) {
          calls.push({ name: 'from', arg: table });
          return {
            where(clause: unknown) {
              calls.push({ name: 'where', arg: clause });
              return Promise.resolve(rows);
            },
          };
        },
      };
    },
    insert(table: unknown) {
      calls.push({ name: 'insert', arg: table });
      return {
        values(row: unknown) {
          calls.push({ name: 'values', arg: row });
          return {
            onConflictDoUpdate(update: unknown) {
              calls.push({ name: 'onConflictDoUpdate', arg: update });
              return Promise.resolve();
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as PostgresJsDatabase, calls };
}

function callNamed(calls: Call[], name: string): unknown {
  const found = calls.find((call) => call.name === name);
  if (found === undefined) {
    throw new Error(`missing ${name}`);
  }
  return found.arg;
}

describe('postgres display store', () => {
  it('returns undefined when the select has no row', async () => {
    const { db, calls } = createStub([]);
    const store = createPgDisplayStore(db);
    expect(await store.getDisplayValue()).toBeUndefined();
    expect(callNamed(calls, 'select')).toEqual({ value: appSettings.value });
    expect(callNamed(calls, 'from')).toBe(appSettings);
    expect(callNamed(calls, 'where')).toEqual(eq(appSettings.key, DISPLAY_SETTINGS_KEY));
  });

  it('returns the stored value', async () => {
    const { db } = createStub([{ value: VALUE }]);
    const store = createPgDisplayStore(db);
    expect(await store.getDisplayValue()).toEqual(VALUE);
  });

  it('replaces the whole display value', async () => {
    const { db, calls } = createStub([]);
    const store = createPgDisplayStore(db);
    await store.putDisplayValue(VALUE);
    expect(callNamed(calls, 'insert')).toBe(appSettings);
    expect(callNamed(calls, 'values')).toEqual({ key: DISPLAY_SETTINGS_KEY, value: VALUE });
    expect(callNamed(calls, 'onConflictDoUpdate')).toEqual({
      target: appSettings.key,
      set: { value: VALUE },
    });
  });
});
