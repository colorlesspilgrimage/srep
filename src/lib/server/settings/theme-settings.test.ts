import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DbHandle } from '#lib/server/db/client.js';
import { appSettings } from '#lib/server/db/schema/sqlite.js';
import {
  createDomainHarness,
  type DomainHarness,
} from '#lib/server/domain/test-support/harness.js';
import { THEME_SETTINGS_KEY } from '#lib/server/settings/theme-key.js';
import { getThemeSettings, putThemeSettings } from '#lib/server/settings/theme-settings.js';
import { getThemeStore } from '#lib/server/settings/theme-store.js';

// Contract: the saved theme id. A bad id is refused. A bad stored value is not repaired.

const STUDY_VALUE = { rolloverHour: 4, timezone: 'UTC' };
const BAD_IDS = ['nope', 'Nord', 'nord ', '<script>', 'phosphor-green\n'];

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
  it(
    'returns 500 when the stored id is not in the catalog and does not rewrite the row',
    corruptId,
  );
  it('returns 500 when the stored value is a JSON string', corruptString);
});
