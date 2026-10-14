import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { describe, expect, it } from 'vitest';
import { fail } from '#lib/server/auth/deps.js';
import { BUILTIN_NOTE_TYPES, BUILTIN_PRESET } from '#lib/server/domain/builtin.js';
import { deckRow } from '#lib/server/domain/store/suite-support.js';
import { createPgDeckStore } from '#lib/server/domain/store/decks.pg.js';
import { createPgPresetMediaStore } from '#lib/server/domain/store/presets-media.pg.js';
import type { DeckRow, MediaRow, PresetRow } from '#lib/server/domain/store/store-types.js';
import { cacheSlotVersion, readCached } from '#lib/server/read-cache.js';
import { createPgKeybindStore } from '#lib/server/settings/keybind-store.pg.js';
import { createPgThemeStore } from '#lib/server/settings/theme-store.pg.js';
import { createPgStudySettingsStore } from '#lib/server/study/store/settings-store.pg.js';
import { DEFAULT_KEYBINDS } from '#lib/client/tui/keymap.js';

// Contract: Postgres stores with a stub database. No server is used.
// A successful write raises the cache version. A failed write does not.

type Stub = {
  db: PostgresJsDatabase;
  selects: number;
  push: (...rows: unknown[][]) => void;
  failNext: (error: unknown) => void;
};

function chain(result: Promise<unknown>): Record<string, unknown> {
  const node: Record<string, unknown> = {};
  const self = () => node;
  node.from = self;
  node.where = self;
  node.orderBy = self;
  node.limit = self;
  node.set = self;
  node.values = self;
  node.onConflictDoNothing = () => result;
  node.onConflictDoUpdate = () => result;
  node.then = (ok?: unknown, err?: unknown) => result.then(ok as never, err as never);
  return node;
}

function createStub(): Stub {
  const queue: unknown[][] = [];
  let failure: unknown = null;
  const stub: Stub = {
    db: {} as PostgresJsDatabase,
    selects: 0,
    push(...rows) {
      queue.push(...rows);
    },
    failNext(error) {
      failure = error;
    },
  };
  const read = () => chain(Promise.resolve(queue.shift() ?? []));
  const write = () => {
    if (failure !== null) {
      const error = failure;
      failure = null;
      const rejected = Promise.reject(error);
      rejected.catch(() => undefined);
      return chain(rejected);
    }
    return chain(Promise.resolve([]));
  };
  const db = {
    select() {
      stub.selects += 1;
      return read();
    },
    insert: () => write(),
    update: () => write(),
    delete: () => write(),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  stub.db = db as unknown as PostgresJsDatabase;
  return stub;
}

function tree(count: number): DeckRow[] {
  const root = deckRow('root', 'Root');
  const kids = Array.from({ length: count - 1 }, (_, index) =>
    deckRow(`c${index}`, `Kid${index}`, root),
  );
  return [root, ...kids];
}

const mediaRow: MediaRow = {
  id: 'm1',
  sha256: 'abc',
  mime: 'image/png',
  size: 4,
  originalName: 'a.png',
};

describe('postgres deck cache drops', () => {
  it('lists from the cache and drops it after a successful insert', async () => {
    const stub = createStub();
    const store = createPgDeckStore(stub.db);
    stub.push([deckRow('a', 'A')]);
    expect(await store.listDecks()).toHaveLength(1);
    stub.push([deckRow('a', 'A'), deckRow('b', 'B')]);
    expect(await store.listDecks()).toHaveLength(1);
    expect(stub.selects).toBe(1);
    expect(await store.insertDeck(deckRow('b', 'B'))).toBe('ok');
    expect(cacheSlotVersion(stub.db, 'decks')).toBe(1);
    expect(await store.getDeck('a')).toMatchObject({ id: 'a' });
    expect(await store.getDeck('missing')).toBeUndefined();
  });

  it('keeps the cache version when insert fails', async () => {
    const stub = createStub();
    const store = createPgDeckStore(stub.db);
    stub.failNext({ code: '23505' });
    expect(await store.insertDeck(deckRow('a', 'A'))).toBe('name_taken');
    expect(cacheSlotVersion(stub.db, 'decks')).toBe(0);
    stub.failNext(new Error('boom'));
    await expect(store.insertDeck(deckRow('a', 'A'))).rejects.toThrow('boom');
  });

  it('drops the deck cache only when change writes rows', async () => {
    const stub = createStub();
    const store = createPgDeckStore(stub.db);
    const row = deckRow('a', 'A');
    stub.push([row]);
    expect(await store.changeDecks(() => ({ ok: true, updates: [] }))).toMatchObject({ ok: true });
    expect(cacheSlotVersion(stub.db, 'decks')).toBe(0);
    stub.push([row]);
    expect(await store.changeDecks(() => ({ ok: true, updates: [row] }))).toMatchObject({
      ok: true,
    });
    expect(cacheSlotVersion(stub.db, 'decks')).toBe(1);
    stub.push([]);
    expect(await store.changeDecks(() => fail(404, 'not_found'))).toMatchObject({ ok: false });
    expect(cacheSlotVersion(stub.db, 'decks')).toBe(1);
    stub.push([row]);
    stub.failNext({ code: '23505' });
    expect(await store.changeDecks(() => ({ ok: true, updates: [row] }))).toMatchObject({
      error: 'deck_name_taken',
    });
    stub.push([row]);
    stub.failNext(new Error('boom'));
    await expect(store.changeDecks(() => ({ ok: true, updates: [row] }))).rejects.toThrow('boom');
  });

  it('counts a subtree and drops the cache when the deck exists', async () => {
    const stub = createStub();
    const store = createPgDeckStore(stub.db);
    stub.push([]);
    expect(await store.deckImpact('root')).toBeUndefined();
    stub.push([deckRow('root', 'Root')], [{ noteId: 'n1' }, { noteId: 'n1' }]);
    expect(await store.deckImpact('root')).toEqual({ decks: 1, cards: 2, notes: 1 });
    stub.push([]);
    expect(await store.deleteDeckTree('root', { kind: 'trash' }, 5)).toBe('not_found');
    expect(cacheSlotVersion(stub.db, 'decks')).toBe(0);
    const rows = tree(3);
    stub.push(rows);
    expect(await store.deleteDeckTree('root', { kind: 'move', targetDeckId: 'gone' }, 5)).toBe(
      'target_not_found',
    );
    stub.push(rows);
    expect(await store.deleteDeckTree('root', { kind: 'move', targetDeckId: 'c0' }, 5)).toBe(
      'target_in_subtree',
    );
    stub.push(rows);
    expect(await store.deleteDeckTree('c0', { kind: 'move', targetDeckId: 'root' }, 5)).toBe('ok');
    stub.push(tree(501), [{ noteId: 'n1' }], [{ noteId: 'n2' }]);
    expect(await store.deleteDeckTree('root', { kind: 'trash' }, 9)).toBe('ok');
    expect(cacheSlotVersion(stub.db, 'decks')).toBeGreaterThan(0);
  });
});

describe('postgres preset cache drops', () => {
  it('seeds, lists, and writes presets', async () => {
    const stub = createStub();
    const store = createPgPresetMediaStore(stub.db);
    stub.push([{ id: 't1' }], [], [{ id: 't3' }]);
    await store.seedDefaults({
      preset: BUILTIN_PRESET,
      noteTypes: BUILTIN_NOTE_TYPES.slice(0, 3),
    });
    stub.push([BUILTIN_PRESET]);
    expect(await store.listPresets()).toHaveLength(1);
    expect(await store.listPresets()).toHaveLength(1);
    expect(stub.selects).toBe(4);
    expect(await store.getPreset('missing')).toBeUndefined();
    const next: PresetRow = { ...BUILTIN_PRESET, id: 'p2', name: 'Fast', fsrsParams: [1] };
    stub.push([{ id: 'other' }]);
    expect(await store.insertPreset(next)).toBe('name_taken');
    expect(cacheSlotVersion(stub.db, 'presets')).toBe(0);
    stub.push([]);
    expect(await store.insertPreset(next)).toBe('ok');
    expect(cacheSlotVersion(stub.db, 'presets')).toBe(1);
    stub.failNext({ code: '23505' });
    stub.push([]);
    expect(await store.insertPreset(next)).toBe('name_taken');
    stub.push([]);
    stub.failNext(new Error('boom'));
    await expect(store.insertPreset(next)).rejects.toThrow('boom');
  });

  it('updates and deletes a preset only after success', async () => {
    const stub = createStub();
    const store = createPgPresetMediaStore(stub.db);
    const row: PresetRow = { ...BUILTIN_PRESET, id: 'p2', name: 'Fast' };
    stub.push([]);
    expect(await store.updatePreset(row)).toBe('not_found');
    stub.push([row], [{ id: 'other' }]);
    expect(await store.updatePreset(row)).toBe('name_taken');
    stub.push([row], []);
    expect(await store.updatePreset(row)).toBe('ok');
    expect(cacheSlotVersion(stub.db, 'presets')).toBe(1);
    stub.push([]);
    expect(await store.deletePresetUnlessUsed('p2')).toBe('not_found');
    stub.push([row], [{ id: 'deck' }]);
    expect(await store.deletePresetUnlessUsed('p2')).toBe('in_use');
    expect(cacheSlotVersion(stub.db, 'presets')).toBe(1);
    stub.push([row], []);
    expect(await store.deletePresetUnlessUsed('p2')).toBe('deleted');
    expect(cacheSlotVersion(stub.db, 'presets')).toBe(2);
  });

  it('reads media rows and reports missing hashes', async () => {
    const stub = createStub();
    const store = createPgPresetMediaStore(stub.db);
    stub.push([mediaRow]);
    expect(await store.insertMediaIfAbsent(mediaRow)).toEqual(mediaRow);
    stub.push([mediaRow]);
    expect(await store.getMediaBySha('abc')).toEqual(mediaRow);
    const shas = Array.from({ length: 501 }, (_, index) => `s${index}`);
    stub.push(
      shas.slice(0, 500).map((sha) => ({ sha })),
      [],
    );
    expect(await store.findMissingMedia(shas)).toEqual(['s500']);
  });
});

describe('postgres settings cache drops', () => {
  it('caches study, theme, and keybind rows and drops them on write', async () => {
    const studyDb = createStub();
    const study = createPgStudySettingsStore(studyDb.db);
    studyDb.push([{ value: { rolloverHour: 4, timezone: 'UTC' } }]);
    expect(await study.getStudySettings()).toMatchObject({ timezone: 'UTC' });
    expect(await study.getStudySettings()).toMatchObject({ timezone: 'UTC' });
    expect(studyDb.selects).toBe(1);
    await study.putStudySettings({ rolloverHour: 5, timezone: 'UTC' });
    expect(cacheSlotVersion(studyDb.db, 'study')).toBe(1);
    studyDb.push([]);
    expect(await study.getStudySettings()).toBeUndefined();

    const themeDb = createStub();
    const theme = createPgThemeStore(themeDb.db);
    themeDb.push([]);
    expect(await theme.getThemeValue()).toBeUndefined();
    await theme.putThemeValue({ id: 'nord' });
    expect(cacheSlotVersion(themeDb.db, 'theme')).toBe(1);

    const keyDb = createStub();
    const keys = createPgKeybindStore(keyDb.db);
    keyDb.push([]);
    expect(await keys.getKeybindValue()).toBeNull();
    keyDb.push([{ value: DEFAULT_KEYBINDS }]);
    await keys.putKeybindValue(DEFAULT_KEYBINDS);
    expect(await keys.getKeybindValue()).toEqual(DEFAULT_KEYBINDS);
    expect(cacheSlotVersion(keyDb.db, 'keybinds')).toBe(1);
  });
});

describe('postgres transaction stamp', () => {
  it('keeps a hit while xact_commit stays and reloads when it changes', async () => {
    let commit = 5n;
    let missing = false;
    const selects: number[] = [];
    const db = {
      $client: function sql() {
        return undefined;
      },
      select() {
        selects.push(1);
        return chain(Promise.resolve([{ id: 'a', path: 'A' }]));
      },
      async execute() {
        if (missing) {
          return [{}];
        }
        return [{ xact_commit: commit.toString() }];
      },
    };
    const store = createPgDeckStore(db as unknown as PostgresJsDatabase);
    await store.listDecks();
    const warm = selects.length;
    await store.listDecks();
    expect(selects.length).toBe(warm);
    commit += 1n;
    await store.listDecks();
    expect(selects.length).toBe(warm + 1);
    missing = true;
    await store.listDecks();
    expect(selects.length).toBe(warm + 1);
  });

  it('reads xact_commit once for two slots at the same time', async () => {
    let checks = 0;
    const db = {
      $client: function sql() {
        return undefined;
      },
      async execute() {
        checks += 1;
        return [{ xact_commit: '4' }];
      },
    };
    const load = async () => ['row'];
    await readCached(db, 'decks', load);
    await readCached(db, 'presets', load);
    const before = checks;
    await Promise.all([readCached(db, 'decks', load), readCached(db, 'presets', load)]);
    expect(checks - before).toBe(1);
  });
});
