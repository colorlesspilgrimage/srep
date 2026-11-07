import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { BUILTIN_PRESET } from '#lib/server/domain/builtin.js';
import type { DeckRow, PresetRow } from '#lib/server/domain/store/store-types.js';
import { execSql } from '#lib/server/domain/store/suite-support.js';
import {
  addDeck,
  addPreset,
  addStudyNote,
  createStudyHarness,
  type StudyHarness,
} from '#lib/server/study/test-support/harness.js';
import { getDeckCounts, randomOrderDeckIds, toRollupDecks } from './deck-counts.js';

let h: StudyHarness | undefined;

afterEach(async () => {
  await h?.close();
  h = undefined;
});

function deck(id: string, presetId: string, archivedAt: number | null = null): DeckRow {
  return {
    id,
    parentId: null,
    name: id,
    path: id,
    presetId,
    description: '',
    archivedAt,
  };
}

function preset(id: string, newOrder: PresetRow['newOrder']): PresetRow {
  return { ...BUILTIN_PRESET, id, newOrder };
}

describe('toRollupDecks and randomOrderDeckIds', () => {
  it('drops an archived deck and uses zero when the preset is missing', () => {
    const presets = [preset('known', 'added')];
    const rows = toRollupDecks(
      [deck('a', 'known'), deck('b', 'missing'), deck('c', 'known', 9)],
      presets,
    );
    expect(rows.map((row) => [row.id, row.newPerDay])).toEqual([
      ['a', BUILTIN_PRESET.newPerDay],
      ['b', 0],
    ]);
    expect(
      randomOrderDeckIds(
        [deck('a', 'rand'), deck('b', 'added'), deck('c', 'rand', 4)],
        [preset('rand', 'random'), preset('added', 'added')],
      ),
    ).toEqual(['a']);
  });
});

describe('getDeckCounts', () => {
  it('a line of three decks shows New 1 on the leaf and each ancestor', async () => {
    h = await createStudyHarness();
    const root = await addDeck(h, 'Languages');
    const mid = await addDeck(h, 'Spanish', { parentId: root.id });
    const leaf = await addDeck(h, 'French', { parentId: mid.id });
    await addStudyNote(h, leaf.id);
    const result = await getDeckCounts(h.study);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const byId = new Map(result.counts.map((row) => [row.id, row]));
    for (const id of [root.id, mid.id, leaf.id]) {
      expect(byId.get(id)?.subtree.new).toBe(1);
    }
    expect(byId.get(leaf.id)?.own.new).toBe(1);
    expect(byId.get(root.id)?.own.new).toBe(0);
  });

  it('returns the settings error when study settings are corrupt', async () => {
    h = await createStudyHarness();
    let reads = 0;
    h.study.store.readStudySnapshots = async () => {
      reads += 1;
      return [];
    };
    await execSql(h, sql`insert into app_settings (key, value) values ('study', '"x"')`);
    expect(await getDeckCounts(h.study)).toEqual({
      ok: false,
      status: 500,
      error: 'settings_corrupt',
    });
    expect(reads).toBe(0);
  });

  it('reads snapshots once and does not call unburyExpired', async () => {
    h = await createStudyHarness();
    const plain = await addDeck(h, 'Plain');
    const randomPreset = await addPreset(h, { name: 'Rand', newOrder: 'random' });
    const random = await addDeck(h, 'Random', { presetId: randomPreset.id });
    let unbury = 0;
    let reads = 0;
    const read = h.study.store.readStudySnapshots.bind(h.study.store);
    h.study.store.unburyExpired = async () => {
      unbury += 1;
      return 0;
    };
    h.study.store.readStudySnapshots = async (input) => {
      reads += 1;
      expect(input.shuffleDeckIds).toEqual([random.id]);
      expect([...input.deckIds].sort()).toEqual([plain.id, random.id].sort());
      return read(input);
    };
    const result = await getDeckCounts(h.study);
    expect(result.ok).toBe(true);
    expect(reads).toBe(1);
    expect(unbury).toBe(0);
  });
});
