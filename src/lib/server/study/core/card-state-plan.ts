// Contract: pure plans for suspend, unsuspend and bury. Input: the current card rows.
// Output: the rows to change. Cards already in the target state are left out (idempotent).
// planUnsuspend fails with 409 card_orphaned for a cloze card whose index is gone.
// No I/O. sched_state never changes here, so unsuspend and unbury keep the old schedule.
import { fail, type Failure } from '#lib/server/auth/deps.js';
import { FLAG_ORPHANED } from '#lib/server/domain/core/card-plan.js';
import type { CardRow, CardState } from '#lib/server/domain/store/store-types.js';
import { isParkedState } from '#lib/server/study/core/parked-state.js';

export type CardStateUpdate = { id: string; state: CardState; buriedUntil: number | null };

export type CardStatePlan = { ok: true; updates: CardStateUpdate[] };

export type CardStateGroup = { state: CardState; buriedUntil: number | null; ids: string[] };

// Groups the updates by their values, so one statement serves many cards.
export function groupStateUpdates(updates: CardStateUpdate[]): CardStateGroup[] {
  const groups = new Map<string, CardStateGroup>();
  for (const update of updates) {
    const key = `${update.state}|${update.buriedUntil}`;
    const group = groups.get(key) ?? {
      state: update.state,
      buriedUntil: update.buriedUntil,
      ids: [],
    };
    group.ids.push(update.id);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function planSuspend(cards: CardRow[]): CardStatePlan {
  return {
    ok: true,
    updates: cards
      .filter((c) => c.state !== 'suspended')
      .map((c) => ({ id: c.id, state: 'suspended', buriedUntil: null })),
  };
}

// The user must edit the note to bring back the cloze index before an orphan returns.
export function planUnsuspend(cards: CardRow[]): CardStatePlan | Failure {
  const suspended = cards.filter((c) => c.state === 'suspended');
  if (suspended.some((c) => (c.flags & FLAG_ORPHANED) !== 0)) {
    return fail(409, 'card_orphaned');
  }
  return {
    ok: true,
    updates: suspended.map((c) => ({ id: c.id, state: c.schedState, buriedUntil: null })),
  };
}

export function planBury(cards: CardRow[], untilMs: number): CardStatePlan {
  return {
    ok: true,
    updates: cards
      .filter((c) => !isParkedState(c.state))
      .map((c) => ({ id: c.id, state: 'buried', buriedUntil: untilMs })),
  };
}
