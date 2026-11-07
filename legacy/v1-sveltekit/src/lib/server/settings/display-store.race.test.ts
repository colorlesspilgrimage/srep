import path from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '#lib/server/config.js';
import { createDb, type DbHandle } from '#lib/server/db/client.js';
import { runMigrations } from '#lib/server/db/migrate.js';
import { appSettings } from '#lib/server/db/schema/sqlite.js';
import { DISPLAY_SETTINGS_KEY } from '#lib/server/settings/display-key.js';
import { createSqliteDisplayStore } from '#lib/server/settings/display-store.sqlite.js';
import { makeTempDir, removeTempDirs } from '#lib/server/temp-dir.js';

const STUDY_VALUE = { rolloverHour: 4, timezone: 'UTC' };
const LEFT = {
  fontSize: 14,
  reducedMotion: true,
  scanline: false,
  cursorBlink: false,
};
const RIGHT = {
  fontSize: 20,
  reducedMotion: false,
  scanline: true,
  cursorBlink: true,
};
const silent = { info: () => undefined };

describe('display store race', () => {
  it('keeps one display row when two writes run together', async () => {
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
      const left = createSqliteDisplayStore(first.db);
      const right = createSqliteDisplayStore(second.db);
      await Promise.all([left.putDisplayValue(LEFT), right.putDisplayValue(RIGHT)]);
      const rows = first.db
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, DISPLAY_SETTINGS_KEY))
        .all();
      expect(rows).toHaveLength(1);
      expect([LEFT, RIGHT]).toContainEqual(rows[0]?.value);
      const study = first.db.select().from(appSettings).where(eq(appSettings.key, 'study')).get();
      expect(study?.value).toEqual(STUDY_VALUE);
    } finally {
      await first?.close();
      await second?.close();
      removeTempDirs(dirs);
    }
  });
});
