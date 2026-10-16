// Contract: roll deck counts up the parent links.
// Input: decks with id, parentId, archivedAt, and that deck's quota.
// Input: DeckSnapshot rows from one read.
// An archived deck is left out. A deck with no snapshot counts as zero.
// own new and own due come from remainingQuota. own learning is learningTodayCount.
// subtree is the deck plus every visible descendant.
// A missing parent does not throw. A parent cycle does not throw.
// Output: one record per visible deck, in input order.
// No I/O.

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
  return { new: left.newLeft, learning: snapshot.learningTodayCount, due: left.reviewLeft };
}

function childIds(decks: readonly RollupDeck[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const deck of decks) {
    if (deck.parentId === null) {
      continue;
    }
    const list = map.get(deck.parentId) ?? [];
    list.push(deck.id);
    map.set(deck.parentId, list);
  }
  return map;
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
    return own.get(id) ?? zeroCounts();
  }
  seen.add(id);
  let total = own.get(id) ?? zeroCounts();
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
  const children = childIds(visible);
  const memo = new Map<string, CountTriple>();
  return visible.map((deck) => ({
    id: deck.id,
    parentId: deck.parentId,
    own: own.get(deck.id) ?? zeroCounts(),
    subtree: subtreeOf(deck.id, own, children, memo, new Set()),
  }));
}
