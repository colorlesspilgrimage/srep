// Contract: roll counts up parent links. No I/O. Output keeps input order.
// Decks have id, parentId, archivedAt, and a quota. Snapshots come from one read.
// Archived decks are left out. A missing snapshot is zero. subtree adds descendants.
// own new and due use remainingQuota. own learning is learningTodayCount.
// A negative or non-finite count is zero. A missing parent or a cycle does not throw.

import { childrenByParent, shownCount } from '#lib/client/app/deck-screen.js';
import { remainingQuota, type DeckQuota, type DeckSnapshot } from './queue-choice.js';

export type CountTriple = { new: number; learning: number; due: number };

export type RollupDeck = {
  id: string;
  parentId: string | null;
  archivedAt: number | null;
  newPerDay: number;
  reviewsPerDay: number;
};

export type DeckCountRecord = {
  id: string;
  parentId: string | null;
  own: CountTriple;
  subtree: CountTriple;
};

function zeroCounts(): CountTriple {
  return { new: 0, learning: 0, due: 0 };
}

function addCounts(left: CountTriple, right: CountTriple): CountTriple {
  return {
    new: left.new + right.new,
    learning: left.learning + right.learning,
    due: left.due + right.due,
  };
}

function ownCounts(deck: RollupDeck, snapshot: DeckSnapshot | undefined): CountTriple {
  if (snapshot === undefined) {
    return zeroCounts();
  }
  const quota: DeckQuota = {
    deckId: deck.id,
    newPerDay: deck.newPerDay,
    reviewsPerDay: deck.reviewsPerDay,
    newOrder: 'added',
  };
  const left = remainingQuota(snapshot, quota);
  return {
    new: shownCount(left.newLeft),
    learning: shownCount(snapshot.learningTodayCount),
    due: shownCount(left.reviewLeft),
  };
}

function subtreeOf(
  id: string,
  own: Map<string, CountTriple>,
  children: Map<string, string[]>,
  memo: Map<string, CountTriple>,
  seen: Set<string>,
): CountTriple {
  const cached = memo.get(id);
  if (cached !== undefined) {
    return cached;
  }
  if (seen.has(id)) {
    return zeroCounts();
  }
  seen.add(id);
  // Every id here is a visible deck, so the map has a row.
  const base = own.get(id) as CountTriple;
  let total = { new: base.new, learning: base.learning, due: base.due };
  for (const child of children.get(id) ?? []) {
    total = addCounts(total, subtreeOf(child, own, children, memo, seen));
  }
  memo.set(id, total);
  return total;
}

export function rollupDeckCounts(
  decks: readonly RollupDeck[],
  snapshots: readonly DeckSnapshot[],
): DeckCountRecord[] {
  const visible = decks.filter((deck) => deck.archivedAt === null);
  const bySnapshot = new Map(snapshots.map((row) => [row.deckId, row]));
  const own = new Map(visible.map((deck) => [deck.id, ownCounts(deck, bySnapshot.get(deck.id))]));
  const children = childrenByParent(visible);
  const memo = new Map<string, CountTriple>();
  return visible.map((deck) => ({
    id: deck.id,
    parentId: deck.parentId,
    own: own.get(deck.id) as CountTriple,
    subtree: subtreeOf(deck.id, own, children, memo, new Set()),
  }));
}
