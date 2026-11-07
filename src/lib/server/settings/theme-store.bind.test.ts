import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { appSettings } from '#lib/server/db/schema/sqlite.js';
import { THEME_SETTINGS_KEY } from '#lib/server/settings/theme-key.js';
import { getThemeSettings } from '#lib/server/settings/theme-settings.js';
import { createSqliteThemeStore } from '#lib/server/settings/theme-store.sqlite.js';
import { openTracedAppSettings } from '#lib/server/settings/test-support/traced-app-settings.js';

const EVIL_ID = "x' OR 1=1; DROP TABLE app_settings;--";
const STUDY_VALUE = { rolloverHour: 4, timezone: 'UTC' };
const AUTH_VALUE = { done: true };

describe('theme store binding', () => {
  it('keeps the id out of the SQL text', async () => {
    const { sqlite, sqls, db } = openTracedAppSettings();
    const store = createSqliteThemeStore(db);
    await store.putThemeValue({ id: EVIL_ID });
    await store.putThemeValue({ id: 'xai-light' });
    const writes = sqls.filter((sql) => sql.includes('insert'));
    expect(writes.length).toBeGreaterThan(0);
    for (const sql of writes) {
      expect(sql).not.toContain(EVIL_ID);
      expect(sql).not.toContain('DROP TABLE');
      expect(sql).toContain('?');
    }
    const names = sqlite.prepare("select name from sqlite_master where type = 'table'").all();
    expect(names).toEqual([{ name: 'app_settings' }]);
    expect(await store.getThemeValue()).toEqual({ id: 'xai-light' });
    sqlite.close();
  });

  it('drops extra fields and leaves other keys in place', async () => {
    const { sqlite, db } = openTracedAppSettings();
    const store = createSqliteThemeStore(db);
    db.insert(appSettings).values({ key: 'study', value: STUDY_VALUE }).run();
    db.insert(appSettings).values({ key: 'auth.setup_complete', value: AUTH_VALUE }).run();
    await store.putThemeValue({ id: 'xai-light', key: 'auth.user_id' } as { id: string });
    expect(await store.getThemeValue()).toEqual({ id: 'xai-light' });
    const study = db.select().from(appSettings).where(eq(appSettings.key, 'study')).get();
    const auth = db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, 'auth.setup_complete'))
      .get();
    const theme = db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, THEME_SETTINGS_KEY))
      .get();
    expect(study?.value).toEqual(STUDY_VALUE);
    expect(auth?.value).toEqual(AUTH_VALUE);
    expect(theme?.value).toEqual({ id: 'xai-light' });
    const logger = { error: () => undefined };
    expect(await getThemeSettings(store, logger)).toEqual({ ok: true, id: 'xai-light' });
    sqlite.close();
  });
});
