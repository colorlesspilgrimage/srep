import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYBINDS, PALETTE_OPEN } from '#lib/client/tui/keymap.js';
import { appSettings } from '#lib/server/db/schema/pg.js';
import type { DbHandle } from '#lib/server/db/client.js';
import { KEYBIND_SETTINGS_KEY } from '#lib/server/settings/keybind-key.js';
import { createPgKeybindStore } from '#lib/server/settings/keybind-store.pg.js';
import { getKeybindStore } from '#lib/server/settings/keybind-store.js';

// Contract: the Postgres key-chord store with a stub database. No server is used.

type Call = { name: string; arg: unknown };

type StubRow = { value: unknown };

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

function pgHandle(db: PostgresJsDatabase): DbHandle {
  return {
    dialect: 'postgres',
    db,
    async ping() {
      return undefined;
    },
    async close() {
      return undefined;
    },
  };
}

describe('postgres keybind store', () => {
  it('the factory returns the postgres store', async () => {
    const { db } = createStub([]);
    const store = getKeybindStore(pgHandle(db));
    expect(await store.getKeybindValue()).toBeNull();
  });

  it('returns null when the select has no row', async () => {
    const { db, calls } = createStub([]);
    const store = createPgKeybindStore(db);
    expect(await store.getKeybindValue()).toBeNull();
    expect(callNamed(calls, 'select')).toEqual({ value: appSettings.value });
    expect(callNamed(calls, 'from')).toBe(appSettings);
    expect(callNamed(calls, 'where')).toEqual(eq(appSettings.key, KEYBIND_SETTINGS_KEY));
    expect(calls.some((call) => call.name === 'insert')).toBe(false);
  });

  it('returns the stored value', async () => {
    const stored = { ...DEFAULT_KEYBINDS, [PALETTE_OPEN]: 'Alt+K' };
    const { db } = createStub([{ value: stored }]);
    const store = createPgKeybindStore(db);
    expect(await store.getKeybindValue()).toEqual(stored);
  });

  it('replaces the whole keybinds value and does not touch other keys', async () => {
    const { db, calls } = createStub([]);
    const store = createPgKeybindStore(db);
    const value = { ...DEFAULT_KEYBINDS, [PALETTE_OPEN]: 'Alt+K' };
    await store.putKeybindValue(value);
    expect(calls.map((call) => call.name)).toEqual(['insert', 'values', 'onConflictDoUpdate']);
    expect(callNamed(calls, 'insert')).toBe(appSettings);
    expect(callNamed(calls, 'values')).toEqual({ key: KEYBIND_SETTINGS_KEY, value });
    expect(callNamed(calls, 'onConflictDoUpdate')).toEqual({
      target: appSettings.key,
      set: { value },
    });
    const values = callNamed(calls, 'values') as { key: string };
    expect(values.key).toBe(KEYBIND_SETTINGS_KEY);
    expect(values.key).not.toBe('theme');
    expect(values.key).not.toBe('study');
  });
});
