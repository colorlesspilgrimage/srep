import { describe, expect, it } from 'vitest';
import { FLAG_ORPHANED } from '#lib/server/domain/core/card-plan.js';
import { planBury, planSuspend, planUnsuspend } from '#lib/server/study/core/card-state-plan.js';
import { cardRow } from '#lib/server/study/test-support/rows.js';

const cards = [
  cardRow('new'),
  cardRow('learning', { state: 'learning', schedState: 'learning' }),
  cardRow('review', { state: 'review', schedState: 'review' }),
  cardRow('relearning', { state: 'relearning', schedState: 'relearning' }),
  cardRow('suspended', { state: 'suspended', schedState: 'review' }),
  cardRow('buried', { state: 'buried', schedState: 'new', buriedUntil: 99 }),
];

describe('planSuspend', () => {
  it('suspends every card that is not suspended yet', () => {
    expect(planSuspend(cards).updates).toEqual(
      ['new', 'learning', 'review', 'relearning', 'buried'].map((id) => ({
        id,
        state: 'suspended',
        buriedUntil: null,
      })),
    );
    expect(planSuspend([cards[4] as (typeof cards)[number]]).updates).toEqual([]);
  });
});

describe('planUnsuspend', () => {
  it('restores the scheduling state and leaves other cards alone', () => {
    expect(planUnsuspend(cards)).toEqual({
      ok: true,
      updates: [{ id: 'suspended', state: 'review', buriedUntil: null }],
    });
    expect(planUnsuspend(cards.slice(0, 4))).toEqual({ ok: true, updates: [] });
  });

  it('refuses an orphaned cloze card', () => {
    const orphan = cardRow('o', { state: 'suspended', flags: FLAG_ORPHANED });
    expect(planUnsuspend([orphan, ...cards])).toEqual({
      ok: false,
      status: 409,
      error: 'card_orphaned',
    });
    // The flag of a card that is not suspended does not matter.
    const active = cardRow('a', { flags: FLAG_ORPHANED });
    expect(planUnsuspend([active])).toEqual({ ok: true, updates: [] });
  });
});

describe('planBury', () => {
  it('buries only studyable cards until the given time', () => {
    expect(planBury(cards, 1234).updates).toEqual(
      ['new', 'learning', 'review', 'relearning'].map((id) => ({
        id,
        state: 'buried',
        buriedUntil: 1234,
      })),
    );
    expect(planBury(cards.slice(4), 1234).updates).toEqual([]);
  });
});
