import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DISPLAY, type DisplayPrefs } from '#lib/client/app/display-prefs.js';
import type { DbHandle } from '#lib/server/db/client.js';
import { appSettings, type JsonValue } from '#lib/server/db/schema/sqlite.js';
import {
  createDomainHarness,
  type DomainHarness,
} from '#lib/server/domain/test-support/harness.js';
import { DISPLAY_SETTINGS_KEY } from '#lib/server/settings/display-key.js';
import {
  getDisplaySettings,
  interpretDisplay,
  putDisplaySettings,
} from '#lib/server/settings/display-settings.js';
import { getDisplayStore } from '#lib/server/settings/display-store.js';

const STUDY_VALUE = { rolloverHour: 4, timezone: 'UTC' };
const LARGE: DisplayPrefs = {
  fontSize: 20,
  reducedMotion: true,
  scanline: true,
  cursorBlink: true,
};
const OTHER_ROWS = [
  ['study', STUDY_VALUE],
  ['theme', { id: 'nord' }],
  ['ui', { theme: 'phosphor' }],
  ['auth.setup_complete', { done: true }],
] as const;
const CORRUPT_VALUES: readonly JsonValue[] = [
  { fontSize: 99, reducedMotion: false, scanline: false, cursorBlink: false },
  { fontSize: 16, reducedMotion: false, scanline: false, cursorBlink: false, extra: true },
  { fontSize: '16', reducedMotion: false, scanline: false, cursorBlink: false },
  { fontSize: 16, reducedMotion: 1, scanline: false, cursorBlink: false },
  { fontSize: 16 },
  'display',
  [],
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

function displayRow(db: BetterSQLite3Database) {
  return db.select().from(appSettings).where(eq(appSettings.key, DISPLAY_SETTINGS_KEY)).get();
}

async function openStore() {
  h = await createDomainHarness();
  return { db: sqliteDb(h.handle), store: getDisplayStore(h.handle) };
}

describe('display settings', () => {
  it('returns the defaults when the row is absent', async () => {
    const { store } = await openStore();
    const result = await getDisplaySettings(store, { error: vi.fn() });
    expect(result).toEqual({ ok: true, display: DEFAULT_DISPLAY });
  });

  it('stores and replaces display prefs', async () => {
    const { db, store } = await openStore();
    expect(await putDisplaySettings(store, LARGE)).toEqual({ ok: true, display: LARGE });
    expect(await getDisplaySettings(store, { error: vi.fn() })).toEqual({
      ok: true,
      display: LARGE,
    });
    const next = { ...DEFAULT_DISPLAY, fontSize: 14 };
    expect(await putDisplaySettings(store, next)).toEqual({ ok: true, display: next });
    expect(displayRow(db)?.value).toEqual(next);
  });

  it('refuses a bad body and keeps the stored value', async () => {
    const { db, store } = await openStore();
    await putDisplaySettings(store, LARGE);
    expect(
      await putDisplaySettings(store, {
        fontSize: 99,
        reducedMotion: false,
        scanline: false,
        cursorBlink: false,
      }),
    ).toEqual({ ok: false, status: 400, error: 'bad_request' });
    expect(displayRow(db)?.value).toEqual(LARGE);
  });

  it('does not change study or theme rows', async () => {
    const { db, store } = await openStore();
    for (const [key, value] of OTHER_ROWS) {
      db.insert(appSettings).values({ key, value }).run();
    }
    expect(await putDisplaySettings(store, LARGE)).toEqual({ ok: true, display: LARGE });
    for (const [key, value] of OTHER_ROWS) {
      const row = db.select().from(appSettings).where(eq(appSettings.key, key)).get();
      expect(row?.value).toEqual(value);
    }
  });

  it('returns 500 for corrupt stored values and does not rewrite', async () => {
    const { db, store } = await openStore();
    for (const value of CORRUPT_VALUES) {
      db.insert(appSettings)
        .values({ key: DISPLAY_SETTINGS_KEY, value })
        .onConflictDoUpdate({ target: appSettings.key, set: { value } })
        .run();
      const logger = { error: vi.fn() };
      expect(await getDisplaySettings(store, logger)).toEqual({
        ok: false,
        status: 500,
        error: 'settings_corrupt',
      });
      expect(logger.error.mock.calls).toEqual([[{ key: 'display' }]]);
      expect(displayRow(db)?.value).toEqual(value);
    }
  });

  it('parses a stored display without a second copy of the checks', async () => {
    await openStore();
    const logger = { error: vi.fn() };
    expect(interpretDisplay(undefined, logger)).toEqual({ ok: true, display: DEFAULT_DISPLAY });
    expect(logger.error).not.toHaveBeenCalled();
    expect(interpretDisplay(LARGE, logger)).toEqual({ ok: true, display: LARGE });
    expect(interpretDisplay({ fontSize: 99 }, logger)).toEqual({
      ok: false,
      status: 500,
      error: 'settings_corrupt',
    });
    expect(logger.error).toHaveBeenCalledWith({ key: 'display' });
  });
});
