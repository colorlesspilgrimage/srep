// Contract: pure plans for suspend, unsuspend and bury. Input: the current card rows.
// Output: the rows to change. Cards already in the target state are left out (idempotent).
// planUnsuspend fails with 409 card_orphaned for a cloze card whose index is gone.
// No I/O. sched_state never changes here, so unsuspend and unbury keep the old schedule.
import { fail, type Failure } from '#lib/server/auth/deps.js';
import { FLAG_ORPHANED } from '#lib/server/domain/core/card-plan.js';
import type { CardRow, CardState } from '#lib/server/domain/store/store-types.js';

export type CardStateUpdate = { id: string; state: CardState; buriedUntil: number | null };

export type CardStatePlan = { ok: true; updates: CardStateUpdate[] };

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
      .filter((c) => c.state !== 'suspended' && c.state !== 'buried')
      .map((c) => ({ id: c.id, state: 'buried', buriedUntil: untilMs })),
  };
}
