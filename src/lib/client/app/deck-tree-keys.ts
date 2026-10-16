// Contract: pure key map for the deck tree.
// When a dialog, the palette, a text field, or a modifier chord is active, return none.
// Space asks the caller to prevent the scroll. It does not change the row.
// Delete and Backspace do not delete a deck.
// Shift+Tab is Tab with shiftKey true. isRoot tells a collapsed child from a root.
// No I/O.

export type DeckTreeKeyInput = {
  key: string;
  shiftKey: boolean;
  modified: boolean;
  hasChildren: boolean;
  expanded: boolean;
  isRoot: boolean;
  targetIsField: boolean;
  modalOpen: boolean;
  paletteOpen: boolean;
};

export type DeckTreeKeyAction =
  | { type: 'none' }
  | { type: 'prevent' }
  | { type: 'tab'; shift: boolean }
  | { type: 'focus-name' }
  | { type: 'expand' }
  | { type: 'child' }
  | { type: 'collapse' }
  | { type: 'parent' }
  | { type: 'move'; key: 'ArrowDown' | 'ArrowUp' | 'Home' | 'End' };

const MOVE_KEYS: Record<string, 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'> = {
  ArrowDown: 'ArrowDown',
  j: 'ArrowDown',
  ArrowUp: 'ArrowUp',
  k: 'ArrowUp',
  Home: 'Home',
  End: 'End',
};

function horizontal(input: DeckTreeKeyInput): DeckTreeKeyAction | null {
  const right = input.key === 'ArrowRight' || input.key === 'l';
  const left = input.key === 'ArrowLeft' || input.key === 'h';
  if (!right && !left) {
    return null;
  }
  if (right) {
    if (!input.hasChildren) {
      return { type: 'none' };
    }
    return input.expanded ? { type: 'child' } : { type: 'expand' };
  }
  if (input.hasChildren && input.expanded) {
    return { type: 'collapse' };
  }
  if (!input.isRoot) {
    return { type: 'parent' };
  }
  return { type: 'none' };
}

export function deckTreeKeyAction(input: DeckTreeKeyInput): DeckTreeKeyAction {
  if (input.modalOpen || input.paletteOpen || input.targetIsField || input.modified) {
    return { type: 'none' };
  }
  const move = MOVE_KEYS[input.key];
  if (move !== undefined) {
    return { type: 'move', key: move };
  }
  const side = horizontal(input);
  if (side !== null) {
    return side;
  }
  if (input.key === 'Enter') {
    return { type: 'focus-name' };
  }
  if (input.key === 'Tab') {
    return { type: 'tab', shift: input.shiftKey };
  }
  if (input.key === ' ') {
    return { type: 'prevent' };
  }
  return { type: 'none' };
}
