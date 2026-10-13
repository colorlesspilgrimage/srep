import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PREMADE_THEMES, themeClass } from '#lib/client/tui/themes.js';
import type { DbHandle } from '#lib/server/db/client.js';
import { appSettings, type JsonValue } from '#lib/server/db/schema/sqlite.js';
import {
  createDomainHarness,
  type DomainHarness,
} from '#lib/server/domain/test-support/harness.js';
import { THEME_SETTINGS_KEY } from '#lib/server/settings/theme-key.js';
import {
  getThemeSettings,
  interpretTheme,
  putThemeSettings,
} from '#lib/server/settings/theme-settings.js';
import { getThemeStore } from '#lib/server/settings/theme-store.js';

// Contract: the saved theme id. A bad id is refused. A bad stored value is not repaired.

const STUDY_VALUE = { rolloverHour: 4, timezone: 'UTC' };
const BAD_IDS = ['nope', 'Nord', 'nord ', '<script>', 'phosphor-green\n'];
const CATALOG = new Set(PREMADE_THEMES.map((theme) => theme.id));
const OTHER_ROWS = [
  ['study', STUDY_VALUE],
  ['ui', { theme: 'phosphor' }],
  ['auth.setup_complete', { done: true }],
  ['auth.setup_token_hash', { hash: 'abc' }],
  ['auth.user_id', { id: 'user-1' }],
] as const;
const CORRUPT_VALUES: readonly JsonValue[] = [
  { id: '<script>alert(1)</script>' },
  { id: 'nord', extra: true },
  { id: 'nord', key: 'study' },
  { id: 'nord;background:url(//evil)' },
  { id: 'tui-theme-nord' },
  'nord',
  ['nord'],
  { id: null },
  { id: 1 },
  {},
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

function themeRow(db: BetterSQLite3Database) {
  return db.select().from(appSettings).where(eq(appSettings.key, THEME_SETTINGS_KEY)).get();
}

async function openStore() {
  h = await createDomainHarness();
  return { db: sqliteDb(h.handle), store: getThemeStore(h.handle) };
}

async function absentRow(): Promise<void> {
  const { store } = await openStore();
  const result = await getThemeSettings(store, { error: vi.fn() });
  expect(result).toEqual({ ok: true, id: 'phosphor-green' });
}

async function replaceTheme(): Promise<void> {
  const { db, store } = await openStore();
  expect(await putThemeSettings(store, 'nord')).toEqual({ ok: true, id: 'nord' });
  expect(await getThemeSettings(store, { error: vi.fn() })).toEqual({ ok: true, id: 'nord' });
  expect(await putThemeSettings(store, 'amber-crt')).toEqual({ ok: true, id: 'amber-crt' });
  expect(await getThemeSettings(store, { error: vi.fn() })).toEqual({ ok: true, id: 'amber-crt' });
  const rows = db.select().from(appSettings).where(eq(appSettings.key, THEME_SETTINGS_KEY)).all();
  expect(rows).toHaveLength(1);
  expect(rows[0]?.value).toEqual({ id: 'amber-crt' });
}

async function refuseBadId(): Promise<void> {
  const { db, store } = await openStore();
  await putThemeSettings(store, 'nord');
  for (const id of BAD_IDS) {
    expect(await putThemeSettings(store, id)).toEqual({
      ok: false,
      status: 400,
      error: 'bad_request',
    });
  }
  expect(themeRow(db)?.value).toEqual({ id: 'nord' });
}

async function keepStudyRow(): Promise<void> {
  const { db, store } = await openStore();
  db.insert(appSettings).values({ key: 'study', value: STUDY_VALUE }).run();
  expect(await putThemeSettings(store, 'nord')).toEqual({ ok: true, id: 'nord' });
  const study = db.select().from(appSettings).where(eq(appSettings.key, 'study')).get();
  expect(study?.value).toEqual(STUDY_VALUE);
}

async function corruptId(): Promise<void> {
  const { db, store } = await openStore();
  db.insert(appSettings)
    .values({ key: THEME_SETTINGS_KEY, value: { id: 'nope' } })
    .run();
  const logger = { error: vi.fn() };
  expect(await getThemeSettings(store, logger)).toEqual({
    ok: false,
    status: 500,
    error: 'settings_corrupt',
  });
  expect(logger.error).toHaveBeenCalledTimes(1);
  expect(logger.error).toHaveBeenCalledWith({ key: 'theme' });
  expect(themeRow(db)?.value).toEqual({ id: 'nope' });
}

async function keepOtherKeys(): Promise<void> {
  const { db, store } = await openStore();
  for (const [key, value] of OTHER_ROWS) {
    db.insert(appSettings).values({ key, value }).run();
  }
  expect(await putThemeSettings(store, 'nord')).toEqual({ ok: true, id: 'nord' });
  for (const [key, value] of OTHER_ROWS) {
    const row = db.select().from(appSettings).where(eq(appSettings.key, key)).get();
    expect(row?.value).toEqual(value);
  }
  expect(themeRow(db)?.value).toEqual({ id: 'nord' });
}

async function rejectCorrupt(): Promise<void> {
  const { db, store } = await openStore();
  for (const value of CORRUPT_VALUES) {
    db.insert(appSettings)
      .values({ key: THEME_SETTINGS_KEY, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value } })
      .run();
    const logger = { error: vi.fn() };
    const result = await getThemeSettings(store, logger);
    expect(result).toEqual({ ok: false, status: 500, error: 'settings_corrupt' });
    expect(logger.error.mock.calls).toEqual([[{ key: 'theme' }]]);
    expect(JSON.stringify(result)).not.toContain('<script>');
    expect(themeRow(db)?.value).toEqual(value);
  }
}

async function propertyPut(): Promise<void> {
  const { db, store } = await openStore();
  expect(await putThemeSettings(store, 'nord')).toEqual({ ok: true, id: 'nord' });
  await fc.assert(
    fc.asyncProperty(fc.string({ maxLength: 64 }), async (id) => {
      const before = themeRow(db)?.value;
      const result = await putThemeSettings(store, id);
      const row = themeRow(db)?.value;
      if (CATALOG.has(id)) {
        expect(result).toEqual({ ok: true, id });
        expect(row).toEqual({ id });
        expect(themeClass(id)).toBe(`tui-theme-${id}`);
      } else {
        expect(result).toEqual({ ok: false, status: 400, error: 'bad_request' });
        expect(row).toEqual(before);
      }
      expect(await putThemeSettings(store, 'nord')).toEqual({ ok: true, id: 'nord' });
    }),
    { seed: 1, numRuns: 40 },
  );
}

async function interpretStoredTheme(): Promise<void> {
  await openStore();
  const logger = { error: vi.fn() };
  expect(interpretTheme(undefined, logger)).toEqual({ ok: true, id: 'phosphor-green' });
  expect(logger.error).not.toHaveBeenCalled();
  expect(interpretTheme({ id: 'nord' }, logger)).toEqual({ ok: true, id: 'nord' });
  expect(interpretTheme({ id: 'nope' }, logger)).toEqual({
    ok: false,
    status: 500,
    error: 'settings_corrupt',
  });
  expect(interpretTheme({ id: 'nord', extra: true }, logger).ok).toBe(false);
  expect(logger.error).toHaveBeenCalledWith({ key: 'theme' });
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain('nope');
}

async function corruptString(): Promise<void> {
  const { db, store } = await openStore();
  db.insert(appSettings).values({ key: THEME_SETTINGS_KEY, value: 'nord' }).run();
  const logger = { error: vi.fn() };
  expect(await getThemeSettings(store, logger)).toEqual({
    ok: false,
    status: 500,
    error: 'settings_corrupt',
  });
  expect(logger.error).toHaveBeenCalledTimes(1);
}

describe('theme settings', () => {
  it('returns phosphor-green when the row is absent', absentRow);
  it('stores nord and then replaces it with amber-crt', replaceTheme);
  it('refuses a bad id and keeps the stored id', refuseBadId);
  it('does not change the study row', keepStudyRow);
  it('does not change study, ui, or auth rows', keepOtherKeys);
  it('returns 500 for a stored value that is not a catalog id object', rejectCorrupt);
  it('stores only a catalog id for arbitrary strings', propertyPut);
  it(
    'returns 500 when the stored id is not in the catalog and does not rewrite the row',
    corruptId,
  );
  it('returns 500 when the stored value is a JSON string', corruptString);
  it('parses a stored theme without a second copy of the checks', interpretStoredTheme);
});
