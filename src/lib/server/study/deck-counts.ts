// Contract: read-only deck counts for the home tree.
// Reads settings, decks, presets, and one snapshot batch.
// Does not call unburyExpired. A GET must not write.
// A settings failure is returned as that failure.
// Output: { ok: true, counts } for each visible deck.

import type { Result } from '#lib/server/auth/deps.js';
import type { DeckRow, PresetRow } from '#lib/server/domain/store/store-types.js';
import { studyWindow } from '#lib/server/study/core/day-clock.js';
import {
  rollupDeckCounts,
  type DeckCountRecord,
  type RollupDeck,
} from '#lib/server/study/core/deck-count-rollup.js';
import type { StudyDeps } from '#lib/server/study/deps.js';
import { getSettings } from '#lib/server/study/study-settings.js';

export function toRollupDecks(
  decks: readonly DeckRow[],
  presets: readonly PresetRow[],
): RollupDeck[] {
  const byId = new Map(presets.map((preset) => [preset.id, preset]));
  const rows: RollupDeck[] = [];
  for (const deck of decks) {
    if (deck.archivedAt !== null) {
      continue;
    }
    const preset = byId.get(deck.presetId);
    rows.push({
      id: deck.id,
      parentId: deck.parentId,
      archivedAt: null,
      newPerDay: preset?.newPerDay ?? 0,
      reviewsPerDay: preset?.reviewsPerDay ?? 0,
    });
  }
  return rows;
}

export function randomOrderDeckIds(
  decks: readonly DeckRow[],
  presets: readonly PresetRow[],
): string[] {
  const randomIds = new Set(
    presets.filter((preset) => preset.newOrder === 'random').map((preset) => preset.id),
  );
  return decks
    .filter((deck) => deck.archivedAt === null && randomIds.has(deck.presetId))
    .map((deck) => deck.id);
}

export async function getDeckCounts(
  deps: StudyDeps,
): Promise<Result<{ counts: DeckCountRecord[] }>> {
  const settings = await getSettings(deps);
  if (!settings.ok) {
    return settings;
  }
  const nowMs = deps.now();
  const window = studyWindow(nowMs, settings.settings);
  const [decks, presets] = await Promise.all([deps.domain.listDecks(), deps.domain.listPresets()]);
  const rollupDecks = toRollupDecks(decks, presets);
  const snapshots = await deps.store.readStudySnapshots({
    deckIds: rollupDecks.map((deck) => deck.id),
    nowMs,
    window,
    shuffleDeckIds: randomOrderDeckIds(decks, presets),
  });
  return { ok: true, counts: rollupDeckCounts(rollupDecks, snapshots) };
}
