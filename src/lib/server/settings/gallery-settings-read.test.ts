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

// Contract: the gallery read. A theme query does not rewrite the theme row.

const BAD_THEME_QUERIES = [
  '',
  'Nord',
  'HIGH-CONTRAST',
  'nord\nSet-Cookie: a=1',
  'nord\r\nLocation: https://evil.example',
  '<script>alert(1)</script>',
  '../etc/passwd',
  '..\\..\\windows\\win.ini',
  'nord/../../etc/passwd',
  '%6eord',
  '%2e%2e%2fetc%2fpasswd',
  'javascript:alert(1)',
  'https://evil.example',
  'ノード',
  'n\u200bord',
  '\ufeffnord',
  'nord\u0000',
  'a'.repeat(41),
  'phosphor-green ',
  ' phosphor-green',
];

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
  const rows = [themeRowValue, keyRow];
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
      return chain(rows.shift());
    },
    transaction(
      fn: (tx: { select: () => ReturnType<typeof chain> }) => Promise<unknown>,
      config: unknown,
    ) {
      configs.push(config);
      return fn({ select: () => chain(rows.shift()) });
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

  it('returns 500 when a stored chord is a browser shortcut', async () => {
    const db = await openDb();
    db.insert(appSettings)
      .values({
        key: KEYBIND_SETTINGS_KEY,
        value: { ...DEFAULT_KEYBINDS, [PALETTE_OPEN]: 'Ctrl+W' },
      })
      .run();
    const result = await readGallerySettings(h?.handle as DbHandle, 'nord');
    expect(result).toEqual({ ok: false, status: 500, error: 'settings_corrupt' });
    expect(JSON.stringify(result)).not.toContain('Ctrl+W');
    expect(themeRow(db)).toBeUndefined();
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

  it('rejects a bad theme query and does not write the stored theme', async () => {
    const db = await openDb();
    db.insert(appSettings)
      .values({ key: THEME_SETTINGS_KEY, value: { id: 'amber-crt' } })
      .run();
    for (const query of BAD_THEME_QUERIES) {
      const result = await readGallerySettings(h?.handle as DbHandle, query);
      expect(result, query).toEqual({
        ok: true,
        themeId: 'phosphor-green',
        keybinds: DEFAULT_KEYBINDS,
      });
      expect(JSON.stringify(result), query).not.toContain('<');
      expect(JSON.stringify(result), query).not.toContain('://');
      expect(themeRow(db)?.value).toEqual({ id: 'amber-crt' });
    }
  });

  it('rejects a theme query that is not a string', async () => {
    await openDb();
    const arrayQuery = ['nord'] as unknown as string;
    const objectQuery = { toString: () => 'nord' } as unknown as string;
    expect(await readGallerySettings(h?.handle as DbHandle, arrayQuery)).toEqual({
      ok: true,
      themeId: 'phosphor-green',
      keybinds: DEFAULT_KEYBINDS,
    });
    expect(await readGallerySettings(h?.handle as DbHandle, objectQuery)).toEqual({
      ok: true,
      themeId: 'phosphor-green',
      keybinds: DEFAULT_KEYBINDS,
    });
  });

  it('reads postgres theme and keybind rows from the cache stores', async () => {
    const stored = { ...DEFAULT_KEYBINDS, [PALETTE_OPEN]: 'Alt+K' };
    const stub = pgHandle({ value: { id: 'nord' } }, { value: stored });
    const result = await readGallerySettings(stub.handle, null);
    expect(result).toEqual({ ok: true, themeId: 'nord', keybinds: stored });
    expect(stub.configs).toEqual([]);
    expect(pgSettings.key).toBeDefined();
  });
});
