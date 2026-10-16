import { describe, expect, it } from 'vitest';
import { rollupDeckCounts, type RollupDeck } from './deck-count-rollup.js';
import type { DeckSnapshot } from './queue-choice.js';

function snap(deckId: string, patch: Partial<DeckSnapshot> = {}): DeckSnapshot {
  return {
    deckId,
    newDone: 0,
    reviewDone: 0,
    learningDueCount: 0,
    learningTodayCount: 0,
    learningHead: null,
    nextLearningDue: null,
    reviewDueCount: 0,
    reviewHead: null,
    newCount: 0,
    newHead: null,
    ...patch,
  };
}

function deck(id: string, parentId: string | null, patch: Partial<RollupDeck> = {}): RollupDeck {
  return { id, parentId, archivedAt: null, newPerDay: 20, reviewsPerDay: 200, ...patch };
}

describe('rollupDeckCounts', () => {
  it('rolls a chain of three decks', () => {
    const rows = rollupDeckCounts(
      [deck('a', null), deck('b', 'a'), deck('c', 'b')],
      [
        snap('a', { newCount: 1, learningTodayCount: 1 }),
        snap('b', { newCount: 2, learningTodayCount: 1 }),
        snap('c', { newCount: 3, learningTodayCount: 1 }),
      ],
    );
    expect(rows.map((row) => [row.id, row.own.new, row.subtree.new, row.subtree.learning])).toEqual(
      [
        ['a', 1, 6, 3],
        ['b', 2, 5, 2],
        ['c', 3, 3, 1],
      ],
    );
  });

  it('counts a missing snapshot as zero', () => {
    const rows = rollupDeckCounts(
      [deck('a', null), deck('b', 'a'), deck('c', 'b')],
      [snap('a', { newCount: 1 }), snap('c', { newCount: 3 })],
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get('b')?.own).toEqual({ new: 0, learning: 0, due: 0 });
    expect(byId.get('b')?.subtree.new).toBe(3);
    expect(byId.get('a')?.subtree.new).toBe(4);
  });

  it('leaves an archived deck out of the tree and the parent total', () => {
    const rows = rollupDeckCounts(
      [deck('a', null), deck('b', 'a', { archivedAt: 5 }), deck('c', 'b')],
      [snap('a', { newCount: 1 }), snap('b', { newCount: 9 }), snap('c', { newCount: 3 })],
    );
    expect(rows.map((row) => row.id)).toEqual(['a', 'c']);
    expect(rows[0]?.subtree.new).toBe(1);
    expect(rows[1]?.subtree.new).toBe(3);
  });

  it('uses a quota of zero and remainingQuota instead of the raw count', () => {
    const zero = rollupDeckCounts(
      [deck('a', null, { newPerDay: 0, reviewsPerDay: 0 })],
      [snap('a', { newCount: 5, reviewDueCount: 4, learningTodayCount: 2 })],
    );
    expect(zero[0]?.own).toEqual({ new: 0, learning: 2, due: 0 });
    const limited = rollupDeckCounts(
      [deck('a', null, { newPerDay: 4, reviewsPerDay: 3 })],
      [snap('a', { newCount: 5, newDone: 3, reviewDueCount: 4, reviewDone: 1 })],
    );
    expect(limited[0]?.own.new).toBe(1);
    expect(limited[0]?.own.due).toBe(2);
  });

  it('does not throw when the parent link is missing or cyclic', () => {
    const missing = rollupDeckCounts([deck('c', 'gone')], [snap('c', { newCount: 2 })]);
    expect(missing).toEqual([
      {
        id: 'c',
        parentId: 'gone',
        own: { new: 2, learning: 0, due: 0 },
        subtree: { new: 2, learning: 0, due: 0 },
      },
    ]);
    const cyclic = rollupDeckCounts(
      [deck('a', 'b'), deck('b', 'a')],
      [snap('a', { newCount: 1 }), snap('b', { newCount: 1 })],
    );
    expect(cyclic).toHaveLength(2);
  });
});
