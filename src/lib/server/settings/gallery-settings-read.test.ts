import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_KEYBINDS, PALETTE_OPEN } from '#lib/client/tui/keymap.js';
import type { DbHandle } from '#lib/server/db/client.js';
import { appSettings as pgSettings } from '#lib/server/db/schema/pg.js';
import { appSettings } from '#lib/server/db/schema/sqlite.js';
import {
  createDomainHarness,
  type DomainHarness,
} from '#lib/server/domain/test-support/harness.js';
import { KEYBIND_SETTINGS_KEY } from '#lib/server/settings/keybind-key.js';
import { readGallerySettings } from '#lib/server/settings/gallery-settings-read.js';
import { THEME_SETTINGS_KEY } from '#lib/server/settings/theme-key.js';
import { PG_READ_SNAPSHOT } from '#lib/server/study/store/read-snapshot.pg.js';

// Contract: the gallery read. A theme query does not rewrite the theme row.

let h: DomainHarness | undefined;

afterEach(async () => {
  await h?.close();
  h = undefined;
});

function sqliteDb(handle: DbHandle) {
  if (handle.dialect !== 'sqlite') {
    throw new Error('expected sqlite');
  }
  return handle.db;
}

async function openDb() {
  h = await createDomainHarness();
  return sqliteDb(h.handle);
}

function themeRow(db: ReturnType<typeof sqliteDb>) {
  return db.select().from(appSettings).where(eq(appSettings.key, THEME_SETTINGS_KEY)).get();
}

type StubRow = { value: unknown } | undefined;

function pgHandle(
  themeRowValue: StubRow,
  keyRow: StubRow,
): { handle: DbHandle; configs: unknown[] } {
  const configs: unknown[] = [];
  function chain(row: StubRow) {
    return {
      from() {
        return {
          where() {
            return Promise.resolve(row === undefined ? [] : [row]);
          },
        };
      },
    };
  }
  const db = {
    select() {
      return chain(keyRow);
    },
    transaction(
      fn: (tx: { select: () => ReturnType<typeof chain> }) => Promise<unknown>,
      config: unknown,
    ) {
      configs.push(config);
      let count = 0;
      const tx = {
        select() {
          count += 1;
          return chain(count === 1 ? themeRowValue : keyRow);
        },
      };
      return fn(tx);
    },
  };
  return {
    handle: {
      dialect: 'postgres',
      db: db as unknown as PostgresJsDatabase,
      async ping() {
        return undefined;
      },
      async close() {
        return undefined;
      },
    },
    configs,
  };
}

describe('gallery settings read', () => {
  it('returns phosphor-green and the default chords when no rows exist', async () => {
    const db = await openDb();
    const result = await readGallerySettings(h?.handle as DbHandle, null);
    expect(result).toEqual({
      ok: true,
      themeId: 'phosphor-green',
      keybinds: DEFAULT_KEYBINDS,
    });
    expect(themeRow(db)).toBeUndefined();
  });

  it('uses the nord query and does not rewrite the stored theme', async () => {
    const db = await openDb();
    db.insert(appSettings)
      .values({ key: THEME_SETTINGS_KEY, value: { id: 'amber-crt' } })
      .run();
    const result = await readGallerySettings(h?.handle as DbHandle, 'nord');
    expect(result).toEqual({ ok: true, themeId: 'nord', keybinds: DEFAULT_KEYBINDS });
    expect(themeRow(db)?.value).toEqual({ id: 'amber-crt' });
  });

  it('uses the stored nord theme when the query is null', async () => {
    const db = await openDb();
    db.insert(appSettings)
      .values({ key: THEME_SETTINGS_KEY, value: { id: 'nord' } })
      .run();
    const result = await readGallerySettings(h?.handle as DbHandle, null);
    expect(result).toEqual({ ok: true, themeId: 'nord', keybinds: DEFAULT_KEYBINDS });
    expect(themeRow(db)?.value).toEqual({ id: 'nord' });
  });

  it('returns 500 for a corrupt keybinds row when the query is nord', async () => {
    const db = await openDb();
    db.insert(appSettings)
      .values({ key: THEME_SETTINGS_KEY, value: { id: 'amber-crt' } })
      .run();
    db.insert(appSettings)
      .values({ key: KEYBIND_SETTINGS_KEY, value: { [PALETTE_OPEN]: 'nope' } })
      .run();
    const result = await readGallerySettings(h?.handle as DbHandle, 'nord');
    expect(result).toEqual({ ok: false, status: 500, error: 'settings_corrupt' });
    expect(JSON.stringify(result)).not.toContain('nope');
    expect(themeRow(db)?.value).toEqual({ id: 'amber-crt' });
  });

  it('returns 500 for a corrupt keybinds row when the query is null', async () => {
    const db = await openDb();
    db.insert(appSettings)
      .values({ key: THEME_SETTINGS_KEY, value: { id: 'nord' } })
      .run();
    db.insert(appSettings)
      .values({ key: KEYBIND_SETTINGS_KEY, value: { [PALETTE_OPEN]: 'nope' } })
      .run();
    const result = await readGallerySettings(h?.handle as DbHandle, null);
    expect(result).toEqual({ ok: false, status: 500, error: 'settings_corrupt' });
    expect(themeRow(db)?.value).toEqual({ id: 'nord' });
  });

  it('returns 500 for a corrupt theme row and does not write', async () => {
    const db = await openDb();
    db.insert(appSettings)
      .values({ key: THEME_SETTINGS_KEY, value: { id: 'nope' } })
      .run();
    const result = await readGallerySettings(h?.handle as DbHandle, null);
    expect(result).toEqual({ ok: false, status: 500, error: 'settings_corrupt' });
    expect(themeRow(db)?.value).toEqual({ id: 'nope' });
  });

  it('returns phosphor-green for a script query and keeps the stored theme', async () => {
    const db = await openDb();
    db.insert(appSettings)
      .values({ key: THEME_SETTINGS_KEY, value: { id: 'amber-crt' } })
      .run();
    const result = await readGallerySettings(h?.handle as DbHandle, '<script>');
    expect(result).toEqual({
      ok: true,
      themeId: 'phosphor-green',
      keybinds: DEFAULT_KEYBINDS,
    });
    expect(JSON.stringify(result)).not.toContain('<script>');
    expect(themeRow(db)?.value).toEqual({ id: 'amber-crt' });
  });

  it('reads postgres rows in one snapshot', async () => {
    const stored = { ...DEFAULT_KEYBINDS, [PALETTE_OPEN]: 'Alt+K' };
    const stub = pgHandle({ value: { id: 'nord' } }, { value: stored });
    const result = await readGallerySettings(stub.handle, null);
    expect(result).toEqual({ ok: true, themeId: 'nord', keybinds: stored });
    expect(stub.configs).toEqual([PG_READ_SNAPSHOT]);
    expect(pgSettings.key).toBeDefined();
  });
});
