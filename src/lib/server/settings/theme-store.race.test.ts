import path from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '#lib/server/config.js';
import { createDb, type DbHandle } from '#lib/server/db/client.js';
import { runMigrations } from '#lib/server/db/migrate.js';
import { appSettings } from '#lib/server/db/schema/sqlite.js';
import { THEME_SETTINGS_KEY } from '#lib/server/settings/theme-key.js';
import { createSqliteThemeStore } from '#lib/server/settings/theme-store.sqlite.js';
import { makeTempDir, removeTempDirs } from '#lib/server/temp-dir.js';

// Contract: two theme writes leave one complete row. The study row stays.

const STUDY_VALUE = { rolloverHour: 4, timezone: 'UTC' };
const silent = { info: () => undefined };

describe('theme store race', () => {
  it('keeps one theme id when two writes run together', async () => {
    const dirs: string[] = [];
    const filePath = path.join(makeTempDir(dirs), 'app.db');
    const config = parseConfig({ SREP_DATABASE_URL: `sqlite:${filePath}` });
    let first: DbHandle | undefined;
    let second: DbHandle | undefined;
    try {
      first = createDb(config);
      await runMigrations(first, config, silent);
      second = createDb(config);
      if (first.dialect !== 'sqlite' || second.dialect !== 'sqlite') {
        throw new Error('expected sqlite');
      }
      first.db.insert(appSettings).values({ key: 'study', value: STUDY_VALUE }).run();
      const left = createSqliteThemeStore(first.db);
      const right = createSqliteThemeStore(second.db);
      await Promise.all([
        left.putThemeValue({ id: 'nord' }),
        right.putThemeValue({ id: 'amber-crt' }),
      ]);
      const themes = first.db
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, THEME_SETTINGS_KEY))
        .all();
      expect(themes).toHaveLength(1);
      expect([{ id: 'nord' }, { id: 'amber-crt' }]).toContainEqual(themes[0]?.value);
      const study = first.db.select().from(appSettings).where(eq(appSettings.key, 'study')).get();
      expect(study?.value).toEqual(STUDY_VALUE);
    } finally {
      await first?.close();
      await second?.close();
      removeTempDirs(dirs);
    }
  });
});
