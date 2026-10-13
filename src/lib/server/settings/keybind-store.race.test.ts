import path from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { PALETTE_CLOSE, PALETTE_OPEN, PALETTE_OPEN_COLON } from '#lib/client/tui/keymap.js';
import { parseConfig } from '#lib/server/config.js';
import { createDb, type DbHandle } from '#lib/server/db/client.js';
import { runMigrations } from '#lib/server/db/migrate.js';
import { appSettings } from '#lib/server/db/schema/sqlite.js';
import { KEYBIND_SETTINGS_KEY } from '#lib/server/settings/keybind-key.js';
import { createSqliteKeybindStore } from '#lib/server/settings/keybind-store.sqlite.js';
import { THEME_SETTINGS_KEY } from '#lib/server/settings/theme-key.js';
import { makeTempDir, removeTempDirs } from '#lib/server/temp-dir.js';

// Contract: two key-chord writes leave one complete row. The theme row stays.

const LEFT = {
  [PALETTE_OPEN]: 'Alt+K',
  [PALETTE_OPEN_COLON]: ':',
  [PALETTE_CLOSE]: 'Escape',
};
const RIGHT = {
  [PALETTE_OPEN]: 'Alt+J',
  [PALETTE_OPEN_COLON]: ':',
  [PALETTE_CLOSE]: 'Tab',
};
const silent = { info: () => undefined };

describe('keybind store race', () => {
  it('keeps one keybinds row when two writes run together', async () => {
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
      first.db
        .insert(appSettings)
        .values({ key: THEME_SETTINGS_KEY, value: { id: 'nord' } })
        .run();
      const left = createSqliteKeybindStore(first.db);
      const right = createSqliteKeybindStore(second.db);
      await Promise.all([left.putKeybindValue(LEFT), right.putKeybindValue(RIGHT)]);
      const rows = first.db
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, KEYBIND_SETTINGS_KEY))
        .all();
      expect(rows).toHaveLength(1);
      expect([LEFT, RIGHT]).toContainEqual(rows[0]?.value);
      const open = (rows[0]?.value as { 'palette.open'?: string } | undefined)?.['palette.open'];
      expect(['Alt+K', 'Alt+J']).toContain(open);
      const theme = first.db
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, THEME_SETTINGS_KEY))
        .get();
      expect(theme?.value).toEqual({ id: 'nord' });
    } finally {
      await first?.close();
      await second?.close();
      removeTempDirs(dirs);
    }
  });
});
