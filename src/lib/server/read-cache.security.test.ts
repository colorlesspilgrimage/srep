import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fc from 'fast-check';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { parseConfig } from '#lib/server/config.js';
import { createDb } from '#lib/server/db/client.js';
import { runMigrations } from '#lib/server/db/migrate.js';
import {
  BUILTIN_NOTE_TYPES,
  BUILTIN_PRESET,
  DEFAULT_PRESET_ID,
} from '#lib/server/domain/builtin.js';
import {
  createDomainHarness,
  type DomainHarness,
} from '#lib/server/domain/test-support/harness.js';
import { dropCacheSlot, readCached, type CacheSlot } from '#lib/server/read-cache.js';

// Contract: the read cache must not keep stale, shared, or poisoned rows.

let h: DomainHarness | undefined;
const dirs: string[] = [];

afterEach(async () => {
  await h?.close();
  h = undefined;
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const SLOTS: readonly CacheSlot[] = ['decks', 'presets', 'study', 'theme', 'keybinds'];

describe('read cache security', () => {
  it('does not cache a failed load', async () => {
    const db = { $client: { name: '' } };
    let calls = 0;
    await expect(
      readCached(db, 'study', async () => {
        calls += 1;
        throw new Error('db down');
      }),
    ).rejects.toThrow('db down');
    const value = await readCached(db, 'study', async () => {
      calls += 1;
      return 'ok';
    });
    expect(value).toBe('ok');
    expect(calls).toBe(2);
  });

  it('does not let a caller change a cached row', async () => {
    const db = { $client: { name: '' } };
    const rows = await readCached(db, 'decks', async () => [{ id: 'a', name: 'Alpha' }]);
    rows[0]!.name = 'hacked';
    rows.push({ id: 'b', name: 'Beta' });
    const settings = await readCached(db, 'study', async () => ({ hour: 4, label: '学習' }));
    settings.hour = 99;
    const again = await readCached(db, 'decks', async () => [{ id: 'fresh', name: 'F' }]);
    const hours = await readCached(db, 'study', async () => ({ hour: 1, label: 'x' }));
    expect(again).toEqual([{ id: 'a', name: 'Alpha' }]);
    expect(hours).toEqual({ hour: 4, label: '学習' });
  });

  it('does not store a row that cannot be cloned', async () => {
    const db = { $client: { name: '' } };
    let calls = 0;
    const weird = {
      hop() {
        return 1;
      },
    };
    await readCached(db, 'keybinds', async () => {
      calls += 1;
      return weird;
    });
    const second = await readCached(db, 'keybinds', async () => {
      calls += 1;
      return { ok: true };
    });
    expect(second).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('does not keep a value when the slot drops during the load', async () => {
    const db = { $client: { name: '' } };
    const first = await readCached(db, 'theme', async () => {
      dropCacheSlot(db, 'theme');
      return 'old';
    });
    expect(first).toBe('old');
    expect(await readCached(db, 'theme', async () => 'new')).toBe('new');
  });

  it('does not pin stale rows when the sqlite stamp changes during the load', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srep-cache-race-'));
    dirs.push(dir);
    const file = path.join(dir, 'race.db');
    const config = parseConfig({ SREP_DATABASE_URL: `sqlite:${file}` });
    const handle = createDb(config);
    await runMigrations(handle, config, { info() {} });
    const loaded = await readCached(handle.db, 'decks', async () => {
      fs.utimesSync(file, new Date(10_000), new Date(10_000));
      return [{ id: 'stale' }];
    });
    expect(loaded).toEqual([{ id: 'stale' }]);
    expect(await readCached(handle.db, 'decks', async () => [{ id: 'fresh' }])).toEqual([
      { id: 'fresh' },
    ]);
    await handle.close();
  });

  it('does not pin stale rows when xact_commit changes during the load', async () => {
    let commit = 1;
    const db = {
      $client: function sql() {
        return undefined;
      },
      async execute() {
        return [{ xact_commit: String(commit) }];
      },
    };
    const loaded = await readCached(db, 'decks', async () => {
      commit = 2;
      return 'stale';
    });
    expect(loaded).toBe('stale');
    expect(await readCached(db, 'decks', async () => 'fresh')).toBe('fresh');
  });

  it('does not keep rows when xact_commit is missing', async () => {
    let calls = 0;
    const db = {
      $client: function sql() {
        return undefined;
      },
      async execute() {
        return [{}];
      },
    };
    await readCached(db, 'presets', async () => {
      calls += 1;
      return 'one';
    });
    const second = await readCached(db, 'presets', async () => {
      calls += 1;
      return 'two';
    });
    expect(second).toBe('two');
    expect(calls).toBe(2);
  });

  it('does not cache a postgres read when the commit probe throws', async () => {
    let calls = 0;
    let checks = 0;
    const db = {
      $client: function sql() {
        return undefined;
      },
      async execute() {
        checks += 1;
        if (checks === 2) {
          throw new Error('stat failed');
        }
        return [{ xact_commit: '4' }];
      },
    };
    await expect(
      readCached(db, 'decks', async () => {
        calls += 1;
        return 'row';
      }),
    ).rejects.toThrow('stat failed');
    expect(
      await readCached(db, 'decks', async () => {
        calls += 1;
        return 'row';
      }),
    ).toBe('row');
    expect(calls).toBe(2);
  });

  it('keeps one value per slot for many handles', async () => {
    const db = { $client: { name: '' } };
    const calls: Record<string, number> = {};
    for (const name of SLOTS) {
      calls[name] = 0;
    }
    for (let round = 0; round < 30; round += 1) {
      for (const name of SLOTS) {
        await readCached(db, name, async () => {
          calls[name] = (calls[name] ?? 0) + 1;
          return { round, name };
        });
      }
    }
    for (const name of SLOTS) {
      expect(calls[name]).toBe(1);
    }
    await fc.assert(
      fc.asyncProperty(fc.array(fc.uuid(), { minLength: 2, maxLength: 24 }), async (ids) => {
        const handles = ids.map((id) => ({ tag: id, $client: { name: '' } }));
        await Promise.all(
          handles.map((handle, index) =>
            readCached(handle, 'decks', async () => [{ id: ids[index] ?? '' }]),
          ),
        );
        for (let index = 0; index < handles.length; index += 1) {
          const handle = handles[index];
          const rows = await readCached(handle ?? {}, 'decks', async () => [{ id: 'leak' }]);
          expect(rows).toEqual([{ id: ids[index] ?? '' }]);
        }
      }),
      { seed: 1014, numRuns: 20 },
    );
  });

  it('shows a preset that seedDefaults inserts after a cached list', async () => {
    h = await createDomainHarness();
    if (h.handle.dialect !== 'sqlite') {
      throw new Error('expected sqlite');
    }
    h.handle.db.run(sql`delete from deck_preset where id = ${DEFAULT_PRESET_ID}`);
    expect(await h.store.listPresets()).toEqual([]);
    await h.store.seedDefaults({ preset: BUILTIN_PRESET, noteTypes: BUILTIN_NOTE_TYPES });
    const ids = (await h.store.listPresets()).map((row) => row.id);
    expect(ids).toContain(DEFAULT_PRESET_ID);
  });
});
