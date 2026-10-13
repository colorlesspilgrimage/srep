import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { describe, expect, it } from 'vitest';
import { appSettings } from '#lib/server/db/schema/sqlite.js';
import { THEME_SETTINGS_KEY } from '#lib/server/settings/theme-key.js';
import { getThemeSettings } from '#lib/server/settings/theme-settings.js';
import { createSqliteThemeStore } from '#lib/server/settings/theme-store.sqlite.js';

// Contract: the theme upsert binds its values. It does not join them into SQL text.
// Extra fields do not become other app_settings keys (CWE-89, CWE-915).

const EVIL_ID = "x' OR 1=1; DROP TABLE app_settings;--";
const STUDY_VALUE = { rolloverHour: 4, timezone: 'UTC' };
const AUTH_VALUE = { done: true };

function openTraced() {
  const sqlite = new Database(':memory:');
  const sqls: string[] = [];
  const prepare = sqlite.prepare.bind(sqlite);
  sqlite.prepare = ((sql: string) => {
    sqls.push(sql);
    return prepare(sql);
  }) as typeof sqlite.prepare;
  sqlite.exec('create table app_settings (key text primary key, value text not null)');
  const db = drizzle(sqlite);
  return { sqlite, sqls, db, store: createSqliteThemeStore(db) };
}

describe('theme store binding', () => {
  it('keeps the id out of the SQL text', async () => {
    const { sqlite, sqls, store } = openTraced();
    await store.putThemeValue({ id: EVIL_ID });
    await store.putThemeValue({ id: 'nord' });
    const writes = sqls.filter((sql) => sql.includes('insert'));
    expect(writes.length).toBeGreaterThan(0);
    for (const sql of writes) {
      expect(sql).not.toContain(EVIL_ID);
      expect(sql).not.toContain('DROP TABLE');
      expect(sql).toContain('?');
    }
    const names = sqlite.prepare("select name from sqlite_master where type = 'table'").all();
    expect(names).toEqual([{ name: 'app_settings' }]);
    expect(await store.getThemeValue()).toEqual({ id: 'nord' });
    sqlite.close();
  });

  it('drops extra fields and leaves other keys in place', async () => {
    const { sqlite, db, store } = openTraced();
    db.insert(appSettings).values({ key: 'study', value: STUDY_VALUE }).run();
    db.insert(appSettings).values({ key: 'auth.setup_complete', value: AUTH_VALUE }).run();
    await store.putThemeValue({ id: 'nord', key: 'auth.user_id' } as { id: string });
    expect(await store.getThemeValue()).toEqual({ id: 'nord' });
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
    expect(theme?.value).toEqual({ id: 'nord' });
    const logger = { error: () => undefined };
    expect(await getThemeSettings(store, logger)).toEqual({ ok: true, id: 'nord' });
    sqlite.close();
  });
});
