// Contract: which deck rows are on screen, and how a key changes them.
// Decks are in path order. A child is visible only when every ancestor is expanded.
// A missing parent does not hide the row and does not throw.
// No I/O.

import { listKeyIndex } from '#lib/client/tui/list-state.js';
import type { DeckTreeKeyAction } from './deck-tree-keys.js';

export type TreeDeck = { id: string; parentId: string | null };

export function visibleDeckRows<T extends TreeDeck>(
  decks: readonly T[],
  expandedIds: ReadonlySet<string>,
): T[] {
  const byId = new Map(decks.map((deck) => [deck.id, deck]));
  return decks.filter((deck) => ancestorsOpen(byId, deck, expandedIds));
}

function ancestorsOpen<T extends TreeDeck>(
  byId: Map<string, T>,
  deck: T,
  expandedIds: ReadonlySet<string>,
): boolean {
  const seen = new Set<string>([deck.id]);
  let parentId = deck.parentId;
  while (parentId !== null) {
    if (seen.has(parentId)) {
      return false;
    }
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (parent === undefined) {
      return true;
    }
    if (!expandedIds.has(parent.id)) {
      return false;
    }
    parentId = parent.parentId;
  }
  return true;
}

export function toggleExpanded(
  expandedIds: ReadonlySet<string>,
  id: string,
  hasChildren: boolean,
): Set<string> {
  const next = new Set(expandedIds);
  if (!hasChildren) {
    return next;
  }
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

export function rowFromMove<T>(rows: readonly T[], index: number, key: string): number | null {
  return listKeyIndex(rows.length, index, key);
}

export function deckLevel(decks: readonly TreeDeck[], id: string): number {
  const byId = new Map(decks.map((deck) => [deck.id, deck]));
  let level = 1;
  const seen = new Set<string>([id]);
  let parentId = byId.get(id)?.parentId ?? null;
  while (parentId !== null && !seen.has(parentId)) {
    seen.add(parentId);
    level += 1;
    parentId = byId.get(parentId)?.parentId ?? null;
  }
  return level;
}

export type TreeKeyState = {
  visible: readonly { id: string }[];
  index: number;
  expandedIds: ReadonlySet<string>;
  rowId: string;
  parentId: string | null;
  decks: readonly TreeDeck[];
};

export type TreeEffect =
  | { type: 'ignore' }
  | { type: 'prevent' }
  | { type: 'focus-name' }
  | { type: 'select'; id: string; expandedIds: ReadonlySet<string> };

function movedId(visible: readonly { id: string }[], index: number, key: string): string | null {
  const next = rowFromMove(visible, index, key);
  if (next === null) {
    return null;
  }
  return visible[next]?.id ?? null;
}

function selected(id: string, expandedIds: ReadonlySet<string>): TreeEffect {
  return { type: 'select', id, expandedIds };
}

export function effectForTreeKey(action: DeckTreeKeyAction, state: TreeKeyState): TreeEffect {
  if (action.type === 'none' || action.type === 'tab') {
    return { type: 'ignore' };
  }
  if (action.type === 'prevent') {
    return { type: 'prevent' };
  }
  if (action.type === 'focus-name') {
    return { type: 'focus-name' };
  }
  if (action.type === 'move') {
    const id = movedId(state.visible, state.index, action.key);
    if (id === null) {
      return { type: 'ignore' };
    }
    return selected(id, state.expandedIds);
  }
  if (action.type === 'expand' || action.type === 'collapse') {
    const expandedIds = toggleExpanded(state.expandedIds, state.rowId, true);
    return selected(state.rowId, expandedIds);
  }
  if (action.type === 'child') {
    const child = state.decks.find((deck) => deck.parentId === state.rowId);
    if (child === undefined) {
      return { type: 'ignore' };
    }
    return selected(child.id, state.expandedIds);
  }
  if (state.parentId === null) {
    return { type: 'ignore' };
  }
  return selected(state.parentId, state.expandedIds);
}
