import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { appSettings } from '#lib/server/db/schema/sqlite.js';
import { DISPLAY_SETTINGS_KEY } from '#lib/server/settings/display-key.js';
import { getDisplaySettings } from '#lib/server/settings/display-settings.js';
import { createSqliteDisplayStore } from '#lib/server/settings/display-store.sqlite.js';
import { openTracedAppSettings } from '#lib/server/settings/test-support/traced-app-settings.js';

const EVIL = "x' OR 1=1; DROP TABLE app_settings;--";
const STUDY_VALUE = { rolloverHour: 4, timezone: 'UTC' };
const AUTH_VALUE = { done: true };
const GOOD = {
  fontSize: 18,
  reducedMotion: true,
  scanline: false,
  cursorBlink: true,
};

describe('display store binding', () => {
  it('keeps the payload out of the SQL text', async () => {
    const { sqlite, sqls, db } = openTracedAppSettings();
    const store = createSqliteDisplayStore(db);
    await store.putDisplayValue({
      fontSize: 16,
      reducedMotion: false,
      scanline: false,
      cursorBlink: false,
    });
    await store.putDisplayValue(GOOD);
    const writes = sqls.filter((sql) => sql.includes('insert'));
    expect(writes.length).toBeGreaterThan(0);
    for (const sql of writes) {
      expect(sql).not.toContain(EVIL);
      expect(sql).not.toContain('DROP TABLE');
      expect(sql).toContain('?');
    }
    const names = sqlite.prepare("select name from sqlite_master where type = 'table'").all();
    expect(names).toEqual([{ name: 'app_settings' }]);
    expect(await store.getDisplayValue()).toEqual(GOOD);
    sqlite.close();
  });

  it('drops extra fields and leaves other keys in place', async () => {
    const { sqlite, db } = openTracedAppSettings();
    const store = createSqliteDisplayStore(db);
    db.insert(appSettings).values({ key: 'study', value: STUDY_VALUE }).run();
    db.insert(appSettings).values({ key: 'auth.setup_complete', value: AUTH_VALUE }).run();
    await store.putDisplayValue({
      ...GOOD,
      key: 'auth.user_id',
    } as typeof GOOD & { key: string });
    expect(await store.getDisplayValue()).toEqual(GOOD);
    const study = db.select().from(appSettings).where(eq(appSettings.key, 'study')).get();
    const auth = db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, 'auth.setup_complete'))
      .get();
    const display = db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, DISPLAY_SETTINGS_KEY))
      .get();
    expect(study?.value).toEqual(STUDY_VALUE);
    expect(auth?.value).toEqual(AUTH_VALUE);
    expect(display?.value).toEqual(GOOD);
    const logger = { error: () => undefined };
    expect(await getDisplaySettings(store, logger)).toEqual({ ok: true, display: GOOD });
    sqlite.close();
  });
});
