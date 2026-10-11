import { fail, type Failure } from '#lib/server/auth/deps.js';
import type { DeckChange, DeckRow } from '#lib/server/domain/store/store-types.js';

export const DECK_SEPARATOR = '::';
export const MAX_DECK_NAME = 100;
export const MAX_DECK_DEPTH = 20;
const CONTROL = /\p{Cc}/u;

export type DeckPatch = {
  name?: string;
  parentId?: string | null;
  presetId?: string;
  description?: string;
};

// Returns the trimmed name, or null when the name is not valid.
// \p{Cc} also matches U+0000.
// A name must not start or end with ':'. Such a name makes `:::` in a path, and then
// two different trees can have the same path (for example `a` + `:b` and `a:` + `b`).
export function validateDeckName(name: string): string | null {
  const trimmed = name.trim();
  if (
    trimmed.length < 1 ||
    trimmed.length > MAX_DECK_NAME ||
    trimmed.includes(DECK_SEPARATOR) ||
    trimmed.startsWith(':') ||
    trimmed.endsWith(':') ||
    CONTROL.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

export function pathOf(parent: DeckRow | null, name: string): string {
  return parent === null ? name : `${parent.path}${DECK_SEPARATOR}${name}`;
}

export function depthOf(path: string): number {
  return path.split(DECK_SEPARATOR).length;
}

// A deck is in the subtree when its path is the root path, or starts with root path + '::'.
// Plain string compare. No pattern match, so `%`, `_` and `\` have no special meaning.
export function subtreeIds(decks: DeckRow[], rootId: string): string[] {
  const root = decks.find((d) => d.id === rootId);
  if (root === undefined) {
    return [];
  }
  const prefix = root.path + DECK_SEPARATOR;
  return [root.id, ...decks.filter((d) => d.path.startsWith(prefix)).map((d) => d.id)];
}

// Finds the parent and the path of a new deck.
export function planDeckCreate(
  decks: DeckRow[],
  name: string,
  parentId: string | null,
): Failure | { ok: true; parent: DeckRow | null; path: string } {
  const parent = parentId === null ? null : decks.find((d) => d.id === parentId);
  if (parent === undefined) {
    return fail(404, 'not_found');
  }
  const path = pathOf(parent, name);
  if (depthOf(path) > MAX_DECK_DEPTH) {
    return fail(400, 'bad_request');
  }
  if (decks.some((d) => d.path === path)) {
    return fail(409, 'deck_name_taken');
  }
  return { ok: true, parent, path };
}

type Move = { target: DeckRow; parent: DeckRow | null; name: string; subtree: DeckRow[] };

function resolveMove(decks: DeckRow[], id: string, patch: DeckPatch): Failure | Move {
  const target = decks.find((d) => d.id === id);
  if (target === undefined) {
    return fail(404, 'not_found');
  }
  const name = patch.name === undefined ? target.name : validateDeckName(patch.name);
  if (name === null) {
    return fail(400, 'bad_request');
  }
  const ids = new Set(subtreeIds(decks, id));
  const parentId = patch.parentId === undefined ? target.parentId : patch.parentId;
  const parent = parentId === null ? null : decks.find((d) => d.id === parentId);
  if (parent === undefined) {
    return fail(404, 'not_found');
  }
  if (parent !== null && ids.has(parent.id)) {
    return fail(409, 'deck_cycle');
  }
  return { target, parent, name, subtree: decks.filter((d) => ids.has(d.id)) };
}

// Plans a rename, a move, and a preset or description change of one deck.
// Descendants keep their paths relative to the moved deck.
export function planDeckUpdate(decks: DeckRow[], id: string, patch: DeckPatch): DeckChange {
  const move = resolveMove(decks, id, patch);
  if ('ok' in move) {
    return move;
  }
  const { target, parent, name, subtree } = move;
  const rootPath = pathOf(parent, name);
  const inside = new Set(subtree.map((d) => d.id));
  const taken = new Set(decks.filter((d) => !inside.has(d.id)).map((d) => d.path));
  const updates: DeckRow[] = [];
  for (const deck of subtree) {
    const isTarget = deck.id === target.id;
    const path = isTarget ? rootPath : rootPath + deck.path.slice(target.path.length);
    if (depthOf(path) > MAX_DECK_DEPTH) {
      return fail(400, 'bad_request');
    }
    if (taken.has(path)) {
      return fail(409, 'deck_name_taken');
    }
    const next: DeckRow = isTarget
      ? {
          ...deck,
          name,
          path,
          parentId: parent === null ? null : parent.id,
          presetId: patch.presetId ?? deck.presetId,
          description: patch.description ?? deck.description,
        }
      : { ...deck, path };
    if (JSON.stringify(next) !== JSON.stringify(deck)) {
      updates.push(next);
    }
  }
  return { ok: true, updates };
}
