// Contract: join deck rows with count rows, and pick a move target.
// An archived deck stays off the list. A missing count is zero.
// A move target is not the deck and is not in its subtree.
// No I/O.

export type CountTriple = { new: number; learning: number; due: number };

export type DeckListRow = {
  id: string;
  parentId: string | null;
  name: string;
  archivedAt: number | null;
};

export type CountRow = {
  id: string;
  subtree: CountTriple;
};

export type DeckView = {
  id: string;
  parentId: string | null;
  name: string;
  subtree: CountTriple;
};

// A count on screen is a finite number. A bad JSON value becomes zero (CWE-20).
export function shownCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
}

function copyCounts(value: CountTriple | undefined): CountTriple {
  return {
    new: shownCount(value?.new),
    learning: shownCount(value?.learning),
    due: shownCount(value?.due),
  };
}

export function childrenByParent(
  decks: readonly { id: string; parentId: string | null }[],
): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const deck of decks) {
    if (deck.parentId === null) {
      continue;
    }
    const list = children.get(deck.parentId) ?? [];
    list.push(deck.id);
    children.set(deck.parentId, list);
  }
  return children;
}

export function joinDeckViews(
  decks: readonly DeckListRow[],
  counts: readonly CountRow[],
): DeckView[] {
  const byId = new Map(counts.map((row) => [row.id, row.subtree]));
  const views: DeckView[] = [];
  for (const deck of decks) {
    if (deck.archivedAt !== null) {
      continue;
    }
    views.push({
      id: deck.id,
      parentId: deck.parentId,
      name: deck.name,
      subtree: copyCounts(byId.get(deck.id)),
    });
  }
  return views;
}

export function subtreeIdSet(
  decks: readonly { id: string; parentId: string | null }[],
  rootId: string,
): Set<string> {
  const children = childrenByParent(decks);
  const ids = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || ids.has(id)) {
      continue;
    }
    ids.add(id);
    for (const child of children.get(id) ?? []) {
      stack.push(child);
    }
  }
  return ids;
}

export function moveTargetIds(
  decks: readonly { id: string; parentId: string | null }[],
  rootId: string,
): string[] {
  const blocked = subtreeIdSet(decks, rootId);
  return decks.filter((deck) => !blocked.has(deck.id)).map((deck) => deck.id);
}

export function keptSelection(
  decks: readonly { id: string }[],
  selectedId: string | null,
): string | null {
  if (selectedId !== null && decks.some((deck) => deck.id === selectedId)) {
    return selectedId;
  }
  return decks[0]?.id ?? null;
}

export function expandedWithParent(
  expanded: ReadonlySet<string>,
  parentId: string | null,
): Set<string> {
  const next = new Set(expanded);
  if (parentId !== null) {
    next.add(parentId);
  }
  return next;
}

export function afterMutation(input: {
  decks: readonly { id: string }[];
  expanded: ReadonlySet<string>;
  selectedId: string | null;
  parentId: string | null;
}): { selectedId: string | null; expanded: Set<string> } {
  return {
    selectedId: keptSelection(input.decks, input.selectedId),
    expanded: expandedWithParent(input.expanded, input.parentId),
  };
}
