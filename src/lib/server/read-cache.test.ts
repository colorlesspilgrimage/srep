import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { seededRandom } from '#lib/server/auth/test-support/harness.js';
import { parseConfig } from '#lib/server/config.js';
import { createDb } from '#lib/server/db/client.js';
import { runMigrations } from '#lib/server/db/migrate.js';
import { createDeck, listDecks } from '#lib/server/domain/decks.js';
import type { DomainDeps } from '#lib/server/domain/deps.js';
import { createPreset, deletePreset, updatePreset } from '#lib/server/domain/presets.js';
import { seedDomain } from '#lib/server/domain/seed.js';
import { getDomainStore } from '#lib/server/domain/store/store.js';
import { execSql } from '#lib/server/domain/store/suite-support.js';
import {
  createDomainHarness,
  type DomainHarness,
} from '#lib/server/domain/test-support/harness.js';
import { PRESET_INPUT } from '#lib/server/domain/test-support/fixtures.js';
import { readCached } from '#lib/server/read-cache.js';
import { readGallerySettings } from '#lib/server/settings/gallery-settings-read.js';
import { putKeybindSettings } from '#lib/server/settings/keybind-settings.js';
import { getKeybindStore } from '#lib/server/settings/keybind-store.js';
import { putThemeSettings } from '#lib/server/settings/theme-settings.js';
import { getThemeStore } from '#lib/server/settings/theme-store.js';
import { DEFAULT_KEYBINDS, PALETTE_CLOSE } from '#lib/client/tui/keymap.js';
import { getStudyStore } from '#lib/server/study/store/store.js';
import { getSettings, updateSettings } from '#lib/server/study/study-settings.js';
import type { StudyDeps } from '#lib/server/study/deps.js';
import './read-cache.pg.test.js';

// Contract: one process cache per database object.
// A second read does not select. A write or execSql shows the new row.

let h: DomainHarness | undefined;
const dirs: string[] = [];

afterEach(async () => {
  await h?.close();
  h = undefined;
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function open(): Promise<DomainHarness> {
  h = await createDomainHarness();
  return h;
}

function studyOf(harness: DomainHarness): StudyDeps {
  return {
    store: getStudyStore(harness.handle),
    domain: harness.store,
    now: () => harness.clock.now,
    random: seededRandom(),
    logger: { error() {} },
  };
}

describe('read cache', () => {
  it('does not select decks on the second list', async () => {
    const harness = await open();
    if (harness.handle.dialect !== 'sqlite') {
      throw new Error('expected sqlite');
    }
    const db = harness.handle.db;
    const original = db.select.bind(db);
    let selects = 0;
    db.select = ((...args: Parameters<typeof db.select>) => {
      selects += 1;
      return original(...args);
    }) as typeof db.select;
    const first = await listDecks(harness.deps);
    const afterFirst = selects;
    const second = await listDecks(harness.deps);
    expect(selects).toBe(afterFirst);
    expect(second).toEqual(first);
    if (second.ok) {
      second.decks.push({ ...second.decks[0]!, id: 'extra', name: 'Extra', path: 'Extra' });
    }
    const third = await listDecks(harness.deps);
    expect(third.ok && third.decks.some((deck) => deck.id === 'extra')).toBe(false);
  });

  it('returns a new deck after create and keeps the list after a name clash', async () => {
    const harness = await open();
    const created = await createDeck(harness.deps, { name: 'Alpha' });
    expect(created.ok).toBe(true);
    const listed = await listDecks(harness.deps);
    expect(listed.ok && listed.decks.some((deck) => deck.name === 'Alpha')).toBe(true);
    expect(await createDeck(harness.deps, { name: 'Alpha' })).toMatchObject({
      error: 'deck_name_taken',
    });
    expect(await createDeck(harness.deps, { name: 'Beta' })).toMatchObject({ ok: true });
    const after = await listDecks(harness.deps);
    expect(after.ok && after.decks.map((deck) => deck.name).sort()).toEqual(['Alpha', 'Beta']);
  });

  it('shows an execSql deck rename and corrupt study settings', async () => {
    const harness = await open();
    const created = await createDeck(harness.deps, { name: 'Alpha' });
    if (!created.ok) {
      throw new Error(created.error);
    }
    await listDecks(harness.deps);
    await execSql(harness, sql`update deck set name = 'Renamed' where id = ${created.deck.id}`);
    const listed = await listDecks(harness.deps);
    expect(listed.ok && listed.decks.some((deck) => deck.name === 'Renamed')).toBe(true);
    const study = studyOf(harness);
    expect(await getSettings(study)).toMatchObject({ ok: true });
    await execSql(
      harness,
      sql`insert into app_settings (key, value) values ('study', '{"nope":1}')`,
    );
    expect(await getSettings(study)).toMatchObject({ error: 'settings_corrupt' });
    await execSql(harness, sql`delete from app_settings where key = 'study'`);
    await updateSettings(study, { rolloverHour: 5, timezone: 'UTC' });
    expect(await getSettings(study)).toMatchObject({
      ok: true,
      settings: { rolloverHour: 5, timezone: 'UTC' },
    });
  });

  it('does not share decks across two databases', async () => {
    const left = await open();
    const right = await createDomainHarness();
    await createDeck(left.deps, { name: 'OnlyLeft' });
    const listed = await listDecks(right.deps);
    expect(listed.ok && listed.decks.some((deck) => deck.name === 'OnlyLeft')).toBe(false);
    await right.close();
  });

  it('refreshes gallery settings after theme and keybind writes', async () => {
    const harness = await open();
    expect(await putThemeSettings(getThemeStore(harness.handle), 'nord')).toMatchObject({
      ok: true,
    });
    const keys = { ...DEFAULT_KEYBINDS, [PALETTE_CLOSE]: 'Alt+X' };
    expect(await putKeybindSettings(getKeybindStore(harness.handle), keys)).toMatchObject({
      ok: true,
    });
    const saved = await readGallerySettings(harness.handle, null);
    expect(saved.ok && saved.themeId).toBe('nord');
    expect(saved.ok && saved.keybinds[PALETTE_CLOSE]).toBe('Alt+X');
    const query = await readGallerySettings(harness.handle, 'amber-crt');
    expect(query.ok && query.themeId).toBe('amber-crt');
  });

  it('drops the preset cache after update and delete', async () => {
    const harness = await open();
    const made = await createPreset(harness.deps, { ...PRESET_INPUT, name: 'Fast' });
    if (!made.ok) {
      throw new Error(made.error);
    }
    await harness.store.listPresets();
    expect(
      await updatePreset(harness.deps, made.preset.id, { ...PRESET_INPUT, name: 'Faster' }),
    ).toMatchObject({ ok: true });
    const names = (await harness.store.listPresets()).map((preset) => preset.name);
    expect(names).toContain('Faster');
    const deck = await createDeck(harness.deps, { name: 'Held', presetId: made.preset.id });
    expect(deck.ok).toBe(true);
    expect(await deletePreset(harness.deps, made.preset.id)).toMatchObject({ error: 'in_use' });
    await harness.store.insertMediaIfAbsent({
      id: 'm1',
      sha256: 'abc',
      mime: 'image/png',
      size: 1,
      originalName: 'a.png',
    });
    expect(await harness.store.getMediaBySha('abc')).toMatchObject({ sha256: 'abc' });
    expect(await harness.store.findMissingMedia(['abc', 'missing'])).toEqual(['missing']);
  });

  it('reloads decks when the sqlite file stamp changes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srep-cache-'));
    dirs.push(dir);
    const file = path.join(dir, 'cache.db');
    const config = parseConfig({ SREP_DATABASE_URL: `sqlite:${file}` });
    const handle = createDb(config);
    const silent = { info() {} };
    await runMigrations(handle, config, silent);
    const store = getDomainStore(handle);
    const deps: DomainDeps = {
      store,
      media: {
        async write() {},
        async read() {
          return null;
        },
      },
      now: () => 1,
      random: seededRandom(),
      limits: { mediaMaxBytes: 1024 },
    };
    await seedDomain(deps);
    await createDeck(deps, { name: 'FileDeck' });
    await listDecks(deps);
    const other = createDb(config);
    if (other.dialect !== 'sqlite' || handle.dialect !== 'sqlite') {
      throw new Error('expected sqlite');
    }
    other.db.run(sql`update deck set name = 'Changed' where name = 'FileDeck'`);
    const stamp = new Date(Date.now() + 10_000);
    fs.utimesSync(file, stamp, stamp);
    const wal = `${file}-wal`;
    if (fs.existsSync(wal)) {
      fs.utimesSync(wal, stamp, stamp);
    }
    const listed = await listDecks(deps);
    expect(listed.ok && listed.decks.some((deck) => deck.name === 'Changed')).toBe(true);
    fs.rmSync(file, { force: true });
    const missed = await readCached(handle.db, 'decks', async () => [{ id: 'fresh' }]);
    expect(missed).toEqual([{ id: 'fresh' }]);
    const memory = { $client: { name: '' } };
    expect(await readCached(memory, 'study', async () => 1)).toBe(1);
    expect(await readCached(memory, 'study', async () => 2)).toBe(1);
    const nul = { $client: { name: 'a\0b' } };
    expect(await readCached(nul, 'theme', async () => 't')).toBe('t');
    await other.close();
    await handle.close();
  });
});
