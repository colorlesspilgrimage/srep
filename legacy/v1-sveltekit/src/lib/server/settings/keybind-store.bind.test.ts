import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEYBINDS,
  PALETTE_CLOSE,
  PALETTE_OPEN,
  PALETTE_OPEN_COLON,
  type KeybindMap,
} from '#lib/client/tui/keymap.js';
import { appSettings } from '#lib/server/db/schema/sqlite.js';
import { KEYBIND_SETTINGS_KEY } from '#lib/server/settings/keybind-key.js';
import { createSqliteKeybindStore } from '#lib/server/settings/keybind-store.sqlite.js';
import { openTracedAppSettings } from '#lib/server/settings/test-support/traced-app-settings.js';
import { THEME_SETTINGS_KEY } from '#lib/server/settings/theme-key.js';

const EVIL = "x' OR 1=1; DROP TABLE app_settings;--";
const STUDY_VALUE = { rolloverHour: 4, timezone: 'UTC' };
const THEME_VALUE = { id: 'nord' };

describe('keybind store binding', () => {
  it('keeps the chord text out of the SQL text', async () => {
    const { sqlite, sqls, db } = openTracedAppSettings();
    const store = createSqliteKeybindStore(db);
    const evilMap: KeybindMap = {
      [PALETTE_OPEN]: EVIL,
      [PALETTE_OPEN_COLON]: ':',
      [PALETTE_CLOSE]: 'Escape',
    };
    await store.putKeybindValue(evilMap);
    await store.putKeybindValue(DEFAULT_KEYBINDS);
    const writes = sqls.filter((sql) => sql.includes('insert'));
    expect(writes.length).toBeGreaterThan(0);
    for (const sql of writes) {
      expect(sql).not.toContain(EVIL);
      expect(sql).not.toContain('DROP TABLE');
      expect(sql).toContain('?');
    }
    const names = sqlite.prepare("select name from sqlite_master where type = 'table'").all();
    expect(names).toEqual([{ name: 'app_settings' }]);
    expect(await store.getKeybindValue()).toEqual(DEFAULT_KEYBINDS);
    sqlite.close();
  });

  it('drops extra fields and leaves other keys in place', async () => {
    const { sqlite, db } = openTracedAppSettings();
    const store = createSqliteKeybindStore(db);
    db.insert(appSettings).values({ key: 'study', value: STUDY_VALUE }).run();
    db.insert(appSettings).values({ key: THEME_SETTINGS_KEY, value: THEME_VALUE }).run();
    const extra = {
      ...DEFAULT_KEYBINDS,
      extra: 'Alt+J',
      key: 'theme',
      __proto__: { admin: true },
    } as KeybindMap;
    await store.putKeybindValue(extra);
    expect(await store.getKeybindValue()).toEqual(DEFAULT_KEYBINDS);
    const study = db.select().from(appSettings).where(eq(appSettings.key, 'study')).get();
    const theme = db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, THEME_SETTINGS_KEY))
      .get();
    const keys = db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, KEYBIND_SETTINGS_KEY))
      .get();
    expect(study?.value).toEqual(STUDY_VALUE);
    expect(theme?.value).toEqual(THEME_VALUE);
    expect(keys?.value).toEqual(DEFAULT_KEYBINDS);
    expect(Object.keys(keys?.value as object)).toEqual([
      PALETTE_OPEN,
      PALETTE_OPEN_COLON,
      PALETTE_CLOSE,
    ]);
    expect(Object.prototype).not.toHaveProperty('admin');
    sqlite.close();
  });
});
