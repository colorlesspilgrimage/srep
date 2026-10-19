// Contract: pure key map for the browse screen.
// region is query, grid, or dialog.
// modalOpen blocks the grid. paletteOpen blocks every region.
// Ctrl+K asks for the palette. Ctrl+A selects the field or the page.
// Other modifier chords return none.
// Digits do not rate. Delete and Backspace do not delete.
// No I/O.

export type BrowseRegion = 'query' | 'grid' | 'dialog';

export type BrowseKeyInput = {
  key: string;
  region: BrowseRegion;
  modalOpen: boolean;
  paletteOpen: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  queryEmpty: boolean;
  hasSelection: boolean;
};

export type BrowseMove = 'next' | 'prev' | 'first' | 'last';

export type BrowseKeyAction =
  | { type: 'none' }
  | { type: 'search' }
  | { type: 'clear-query' }
  | { type: 'blur' }
  | { type: 'select-query' }
  | { type: 'palette' }
  | { type: 'move'; move: BrowseMove }
  | { type: 'toggle' }
  | { type: 'open' }
  | { type: 'tab'; shift: boolean }
  | { type: 'clear-selection' }
  | { type: 'select-page' }
  | { type: 'close-dialog' };

const NONE: BrowseKeyAction = { type: 'none' };

const MOVE: Record<string, BrowseMove> = {
  ArrowDown: 'next',
  j: 'next',
  ArrowUp: 'prev',
  k: 'prev',
  Home: 'first',
  End: 'last',
};

function commandChord(input: BrowseKeyInput): boolean {
  return input.ctrlKey || input.metaKey || input.altKey;
}

function plainChord(input: BrowseKeyInput, key: string): boolean {
  return (input.ctrlKey || input.metaKey) && !input.altKey && !input.shiftKey && input.key === key;
}

function modifierAction(input: BrowseKeyInput, onSelect: BrowseKeyAction): BrowseKeyAction | null {
  if (plainChord(input, 'k')) {
    return { type: 'palette' };
  }
  if (plainChord(input, 'a')) {
    return onSelect;
  }
  if (commandChord(input)) {
    return NONE;
  }
  return null;
}

function queryAction(input: BrowseKeyInput): BrowseKeyAction {
  const chord = modifierAction(input, { type: 'select-query' });
  if (chord !== null) {
    return chord;
  }
  if (input.key === 'Enter') {
    return { type: 'search' };
  }
  if (input.key === 'Escape') {
    return input.queryEmpty ? { type: 'blur' } : { type: 'clear-query' };
  }
  return NONE;
}

function gridAction(input: BrowseKeyInput): BrowseKeyAction {
  const chord = modifierAction(input, { type: 'select-page' });
  if (chord !== null) {
    return chord;
  }
  const move = MOVE[input.key];
  if (move !== undefined) {
    return { type: 'move', move };
  }
  if (input.key === ' ') {
    return { type: 'toggle' };
  }
  if (input.key === 'Enter') {
    return { type: 'open' };
  }
  if (input.key === 'Tab') {
    return { type: 'tab', shift: input.shiftKey };
  }
  if (input.key === 'Escape') {
    return input.hasSelection ? { type: 'clear-selection' } : { type: 'blur' };
  }
  return NONE;
}

function dialogAction(input: BrowseKeyInput): BrowseKeyAction {
  if (input.key === 'Escape') {
    return { type: 'close-dialog' };
  }
  return NONE;
}

export function browseKeyAction(input: BrowseKeyInput): BrowseKeyAction {
  if (input.paletteOpen) {
    return NONE;
  }
  if (input.modalOpen && input.region !== 'dialog') {
    return NONE;
  }
  if (input.region === 'query') {
    return queryAction(input);
  }
  if (input.region === 'grid') {
    return gridAction(input);
  }
  return dialogAction(input);
}
