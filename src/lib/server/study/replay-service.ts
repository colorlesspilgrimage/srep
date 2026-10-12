// Contract: verifyReplay replays the review log of every card and compares the result with
// the cached card columns. rebuildFromLog writes the replayed values over the cache.
// A card uses the CURRENT preset of its deck (a card without a deck uses the default
// preset). So a preset edit makes verify report mismatches on purpose; rebuild repairs them.
// A card whose preset ts-fsrs refuses is skipped and counted. Pages of 500 cards (CWE-770).
import type { Result } from '#lib/server/auth/deps.js';
import { BUILTIN_PRESET, DEFAULT_PRESET_ID } from '#lib/server/domain/builtin.js';
import type { CardRow, DeckRow, PresetRow } from '#lib/server/domain/store/store-types.js';
import { schedFieldsOf } from '#lib/server/study/core/answer-plan.js';
import { isParkedState } from '#lib/server/study/core/parked-state.js';
import { compareSched, replayCard } from '#lib/server/study/core/replay.js';
import type { SchedFields } from '#lib/server/study/core/types.js';
import type { StudyDeps } from '#lib/server/study/deps.js';
import {
  REPLAY_PAGE_SIZE,
  type ReplayBatchItem,
} from '#lib/server/study/store/study-store-types.js';

export type VerifyReport = {
  checked: number;
  skipped: number;
  mismatches: { cardId: string; fields: string[] }[];
  chainMismatches: { cardId: string; logIndexes: number[] }[];
};

type CardCheck =
  | { kind: 'skipped' }
  | { kind: 'checked'; fields: string[]; logIndexes: number[]; replayed: SchedFields };

type PresetLookup = (card: CardRow) => PresetRow;

async function presetLookup(deps: StudyDeps): Promise<PresetLookup> {
  const presets = await deps.domain.listPresets();
  const decks: DeckRow[] = await deps.domain.listDecks();
  const fallback = presets.find((p) => p.id === DEFAULT_PRESET_ID) ?? BUILTIN_PRESET;
  return (card) => {
    const deck = decks.find((d) => d.id === card.deckId);
    return presets.find((p) => p.id === deck?.presetId) ?? fallback;
  };
}

// 'state' is listed too when a card that is not suspended or buried has state != schedState.
function checkCard(item: ReplayBatchItem, presetOf: PresetLookup): CardCheck {
  const replay = replayCard(item.logs, presetOf(item.card));
  if (replay === null) {
    return { kind: 'skipped' };
  }
  const { card } = item;
  const fields = compareSched(schedFieldsOf(card), replay.fields);
  if (!isParkedState(card.state) && card.state !== replay.fields.schedState) {
    fields.push('state');
  }
  return { kind: 'checked', fields, logIndexes: replay.chainMismatches, replayed: replay.fields };
}

export async function verifyReplay(deps: StudyDeps): Promise<Result<{ report: VerifyReport }>> {
  const presetOf = await presetLookup(deps);
  const report: VerifyReport = { checked: 0, skipped: 0, mismatches: [], chainMismatches: [] };
  let after: string | null = null;
  for (;;) {
    const batch = await deps.store.readReplayBatch(after, REPLAY_PAGE_SIZE);
    for (const item of batch) {
      const check = checkCard(item, presetOf);
      report.checked += 1;
      if (check.kind === 'skipped') {
        report.skipped += 1;
        continue;
      }
      if (check.fields.length > 0) {
        report.mismatches.push({ cardId: item.card.id, fields: check.fields });
      }
      if (check.logIndexes.length > 0) {
        report.chainMismatches.push({ cardId: item.card.id, logIndexes: check.logIndexes });
      }
    }
    if (batch.length < REPLAY_PAGE_SIZE) {
      return { ok: true, report };
    }
    after = (batch.at(-1) as ReplayBatchItem).card.id;
  }
}

export async function rebuildFromLog(
  deps: StudyDeps,
): Promise<Result<{ checked: number; changed: number; skipped: number }>> {
  const presetOf = await presetLookup(deps);
  let skipped = 0;
  const result = await deps.store.rebuildCards((batch) =>
    batch.flatMap((item) => {
      const check = checkCard(item, presetOf);
      if (check.kind === 'skipped') {
        skipped += 1;
        return [];
      }
      return check.fields.length > 0 ? [{ id: item.card.id, fields: check.replayed }] : [];
    }),
  );
  return { ok: true, ...result, skipped };
}
