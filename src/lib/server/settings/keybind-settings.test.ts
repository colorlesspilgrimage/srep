import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_KEYBINDS,
  PALETTE_CLOSE,
  PALETTE_OPEN,
  PALETTE_OPEN_COLON,
} from '#lib/client/tui/keymap.js';
import type { DbHandle } from '#lib/server/db/client.js';
import { appSettings } from '#lib/server/db/schema/sqlite.js';
import {
  createDomainHarness,
  type DomainHarness,
} from '#lib/server/domain/test-support/harness.js';
import { KEYBIND_SETTINGS_KEY } from '#lib/server/settings/keybind-key.js';
import { getKeybindSettings, putKeybindSettings } from '#lib/server/settings/keybind-settings.js';
import { getKeybindStore } from '#lib/server/settings/keybind-store.js';
import { THEME_SETTINGS_KEY } from '#lib/server/settings/theme-key.js';

// Contract: the saved key chords. A bad map is refused. A bad stored value is not repaired.

const STUDY_VALUE = { rolloverHour: 4, timezone: 'UTC' };
const THEME_VALUE = { id: 'nord' };
const ALT_MAP = { ...DEFAULT_KEYBINDS, [PALETTE_OPEN]: 'Alt+K' };
const BAD_MAPS = [
  { [PALETTE_OPEN_COLON]: ':', [PALETTE_CLOSE]: 'Escape' },
  { ...DEFAULT_KEYBINDS, extra: 'Alt+J' },
  { ...DEFAULT_KEYBINDS, [PALETTE_CLOSE]: 'Ctrl+K' },
  { ...DEFAULT_KEYBINDS, [PALETTE_OPEN]: '<script>' },
];

let h: DomainHarness;

afterEach(async () => {
  await h.close();
});

function sqliteDb(handle: DbHandle): BetterSQLite3Database {
  if (handle.dialect !== 'sqlite') {
    throw new Error('expected sqlite');
  }
  return handle.db;
}

async function openStore() {
  h = await createDomainHarness();
  return { db: sqliteDb(h.handle), store: getKeybindStore(h.handle) };
}

function keybindRow(db: BetterSQLite3Database) {
  return db.select().from(appSettings).where(eq(appSettings.key, KEYBIND_SETTINGS_KEY)).get();
}

describe('keybind settings', () => {
  it('returns the default map when the row is absent', async () => {
    const { store } = await openStore();
    const result = await getKeybindSettings(store, { error: vi.fn() });
    expect(result).toEqual({ ok: true, keybinds: DEFAULT_KEYBINDS });
  });

  it('stores Alt+K for palette.open and keeps the other chords', async () => {
    const { db, store } = await openStore();
    expect(await putKeybindSettings(store, DEFAULT_KEYBINDS)).toEqual({
      ok: true,
      keybinds: DEFAULT_KEYBINDS,
    });
    expect(await putKeybindSettings(store, ALT_MAP)).toEqual({ ok: true, keybinds: ALT_MAP });
    expect(await getKeybindSettings(store, { error: vi.fn() })).toEqual({
      ok: true,
      keybinds: ALT_MAP,
    });
    const rows = db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, KEYBIND_SETTINGS_KEY))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toEqual(ALT_MAP);
    expect(ALT_MAP[PALETTE_OPEN_COLON]).toBe(':');
    expect(ALT_MAP[PALETTE_CLOSE]).toBe('Escape');
  });

  it('refuses a bad map and keeps the previous good map', async () => {
    const { db, store } = await openStore();
    expect(await putKeybindSettings(store, ALT_MAP)).toEqual({ ok: true, keybinds: ALT_MAP });
    for (const input of BAD_MAPS) {
      expect(await putKeybindSettings(store, input)).toEqual({
        ok: false,
        status: 400,
        error: 'bad_request',
      });
      expect(keybindRow(db)?.value).toEqual(ALT_MAP);
    }
  });

  it('returns 500 for a bad chord and for a duplicate stored map', async () => {
    const { db, store } = await openStore();
    const badChord = {
      [PALETTE_OPEN]: 'nope',
      [PALETTE_OPEN_COLON]: ':',
      [PALETTE_CLOSE]: 'Escape',
    };
    const duplicate = {
      ...DEFAULT_KEYBINDS,
      [PALETTE_CLOSE]: 'Ctrl+K',
    };
    for (const stored of [badChord, duplicate]) {
      db.insert(appSettings)
        .values({ key: KEYBIND_SETTINGS_KEY, value: stored })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: stored } })
        .run();
      const logger = { error: vi.fn() };
      const result = await getKeybindSettings(store, logger);
      expect(result).toEqual({ ok: false, status: 500, error: 'settings_corrupt' });
      expect(logger.error.mock.calls).toEqual([[{ key: 'keybinds' }]]);
      expect(JSON.stringify(result)).not.toContain('<script>');
    }
  });

  it('returns 500 when the stored open chord is nope', async () => {
    const { db, store } = await openStore();
    const stored = { [PALETTE_OPEN]: 'nope' };
    db.insert(appSettings).values({ key: KEYBIND_SETTINGS_KEY, value: stored }).run();
    const logger = { error: vi.fn() };
    const result = await getKeybindSettings(store, logger);
    expect(result).toEqual({ ok: false, status: 500, error: 'settings_corrupt' });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith({ key: 'keybinds' });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('nope');
    expect(keybindRow(db)?.value).toEqual(stored);
  });

  it('refuses a reserved chord and keeps the previous good map', async () => {
    const { db, store } = await openStore();
    expect(await putKeybindSettings(store, ALT_MAP)).toEqual({ ok: true, keybinds: ALT_MAP });
    const reserved = { ...DEFAULT_KEYBINDS, [PALETTE_OPEN]: 'Ctrl+W' };
    expect(await putKeybindSettings(store, reserved)).toEqual({
      ok: false,
      status: 400,
      error: 'bad_request',
    });
    expect(keybindRow(db)?.value).toEqual(ALT_MAP);
  });

  it('returns 500 when a stored chord is reserved', async () => {
    const { db, store } = await openStore();
    const stored = { ...DEFAULT_KEYBINDS, [PALETTE_OPEN]: 'Ctrl+W' };
    db.insert(appSettings)
      .values({ key: KEYBIND_SETTINGS_KEY, value: stored })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: stored } })
      .run();
    const logger = { error: vi.fn() };
    const result = await getKeybindSettings(store, logger);
    expect(result).toEqual({ ok: false, status: 500, error: 'settings_corrupt' });
    expect(logger.error).toHaveBeenCalledWith({ key: 'keybinds' });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('Ctrl+W');
    expect(keybindRow(db)?.value).toEqual(stored);
  });

  it('refuses prototype keys, nesting, and control characters', async () => {
    const { db, store } = await openStore();
    expect(await putKeybindSettings(store, ALT_MAP)).toEqual({ ok: true, keybinds: ALT_MAP });
    const proto = JSON.parse(
      '{"palette.open":"Ctrl+K","palette.open-colon":":","palette.close":"Escape","__proto__":{"admin":true}}',
    );
    const constructorKey = JSON.parse(
      '{"palette.open":"Ctrl+K","palette.open-colon":":","palette.close":"Escape","constructor":{"prototype":{"x":1}}}',
    );
    const nested = { ...DEFAULT_KEYBINDS, [PALETTE_OPEN]: { nested: { a: 'Ctrl+K' } } };
    const control = { ...DEFAULT_KEYBINDS, [PALETTE_OPEN]: 'Ctrl+K\u0000' };
    const unicode = { ...DEFAULT_KEYBINDS, [PALETTE_OPEN]: 'Ctrl+ı' };
    const deep = { palette: { open: { a: { b: { c: 'Ctrl+K' } } } } };
    const inputs = [proto, constructorKey, nested, control, unicode, deep, ['Ctrl+K']];
    for (const input of inputs) {
      expect(await putKeybindSettings(store, input)).toEqual({
        ok: false,
        status: 400,
        error: 'bad_request',
      });
      expect(keybindRow(db)?.value).toEqual(ALT_MAP);
    }
    expect(Object.prototype).not.toHaveProperty('admin');
  });

  it('does not change the theme row or the study row', async () => {
    const { db, store } = await openStore();
    db.insert(appSettings).values({ key: 'study', value: STUDY_VALUE }).run();
    db.insert(appSettings).values({ key: THEME_SETTINGS_KEY, value: THEME_VALUE }).run();
    expect(await putKeybindSettings(store, ALT_MAP)).toEqual({ ok: true, keybinds: ALT_MAP });
    const study = db.select().from(appSettings).where(eq(appSettings.key, 'study')).get();
    const theme = db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, THEME_SETTINGS_KEY))
      .get();
    expect(study?.value).toEqual(STUDY_VALUE);
    expect(theme?.value).toEqual(THEME_VALUE);
  });
});
