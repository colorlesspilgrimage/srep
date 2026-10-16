import { describe, expect, it } from 'vitest';
import { deckTreeKeyAction, type DeckTreeKeyInput } from './deck-tree-keys.js';

// Contract: every tree key from the deck-list plan.

function input(patch: Partial<DeckTreeKeyInput> = {}): DeckTreeKeyInput {
  return {
    key: 'ArrowDown',
    shiftKey: false,
    modified: false,
    hasChildren: true,
    expanded: false,
    isRoot: true,
    targetIsField: false,
    modalOpen: false,
    paletteOpen: false,
    ...patch,
  };
}

describe('deckTreeKeyAction', () => {
  it('moves with arrows, j, k, Home, and End', () => {
    expect(deckTreeKeyAction(input({ key: 'ArrowDown' }))).toEqual({
      type: 'move',
      key: 'ArrowDown',
    });
    expect(deckTreeKeyAction(input({ key: 'j' }))).toEqual({ type: 'move', key: 'ArrowDown' });
    expect(deckTreeKeyAction(input({ key: 'ArrowUp' }))).toEqual({ type: 'move', key: 'ArrowUp' });
    expect(deckTreeKeyAction(input({ key: 'k' }))).toEqual({ type: 'move', key: 'ArrowUp' });
    expect(deckTreeKeyAction(input({ key: 'Home' }))).toEqual({ type: 'move', key: 'Home' });
    expect(deckTreeKeyAction(input({ key: 'End' }))).toEqual({ type: 'move', key: 'End' });
  });

  it('expands, enters, collapses, or selects the parent', () => {
    expect(deckTreeKeyAction(input({ key: 'ArrowRight' }))).toEqual({ type: 'expand' });
    expect(deckTreeKeyAction(input({ key: 'l' }))).toEqual({ type: 'expand' });
    expect(deckTreeKeyAction(input({ key: 'ArrowRight', expanded: true }))).toEqual({
      type: 'child',
    });
    expect(deckTreeKeyAction(input({ key: 'l', expanded: true }))).toEqual({ type: 'child' });
    expect(deckTreeKeyAction(input({ key: 'ArrowRight', hasChildren: false }))).toEqual({
      type: 'none',
    });
    expect(deckTreeKeyAction(input({ key: 'l', hasChildren: false }))).toEqual({ type: 'none' });
    expect(deckTreeKeyAction(input({ key: 'ArrowLeft', expanded: true }))).toEqual({
      type: 'collapse',
    });
    expect(deckTreeKeyAction(input({ key: 'h', expanded: true }))).toEqual({ type: 'collapse' });
    expect(
      deckTreeKeyAction(input({ key: 'ArrowLeft', hasChildren: false, isRoot: false })),
    ).toEqual({ type: 'parent' });
    expect(deckTreeKeyAction(input({ key: 'h', isRoot: false }))).toEqual({ type: 'parent' });
    expect(deckTreeKeyAction(input({ key: 'ArrowLeft' }))).toEqual({ type: 'none' });
    expect(deckTreeKeyAction(input({ key: 'h' }))).toEqual({ type: 'none' });
  });

  it('focuses the name on Enter, marks Tab, and prevents Space', () => {
    expect(deckTreeKeyAction(input({ key: 'Enter' }))).toEqual({ type: 'focus-name' });
    expect(deckTreeKeyAction(input({ key: 'Tab' }))).toEqual({ type: 'tab', shift: false });
    expect(deckTreeKeyAction(input({ key: 'Tab', shiftKey: true }))).toEqual({
      type: 'tab',
      shift: true,
    });
    expect(deckTreeKeyAction(input({ key: ' ' }))).toEqual({ type: 'prevent' });
  });

  it('does nothing for digits, Escape, delete, page keys, and colon', () => {
    for (const key of [
      '1',
      '2',
      '3',
      '4',
      'Escape',
      'Delete',
      'Backspace',
      'PageUp',
      'PageDown',
      ':',
    ]) {
      expect(deckTreeKeyAction(input({ key }))).toEqual({ type: 'none' });
    }
  });

  it('does nothing when a dialog, palette, field, or modifier is active', () => {
    for (const patch of [
      { modalOpen: true },
      { paletteOpen: true },
      { targetIsField: true },
      { modified: true, key: 'k' },
    ]) {
      expect(deckTreeKeyAction(input(patch))).toEqual({ type: 'none' });
    }
    expect(deckTreeKeyAction(input({ key: ' ', targetIsField: true }))).toEqual({ type: 'none' });
  });
});
