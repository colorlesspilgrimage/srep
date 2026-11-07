import { describe, expect, it } from 'vitest';
import { deckListKey } from './note-deck-keys.js';

describe('deckListKey', () => {
  it('moves on three decks and stops at the ends', () => {
    expect(deckListKey('ArrowDown', 0, 3)).toEqual({ type: 'select', index: 1 });
    expect(deckListKey('j', 1, 3)).toEqual({ type: 'select', index: 2 });
    expect(deckListKey('ArrowDown', 2, 3)).toEqual({ type: 'select', index: 2 });
    expect(deckListKey('j', 2, 3)).toEqual({ type: 'select', index: 2 });
    expect(deckListKey('ArrowUp', 2, 3)).toEqual({ type: 'select', index: 1 });
    expect(deckListKey('k', 1, 3)).toEqual({ type: 'select', index: 0 });
    expect(deckListKey('ArrowUp', 0, 3)).toEqual({ type: 'select', index: 0 });
    expect(deckListKey('k', 0, 3)).toEqual({ type: 'select', index: 0 });
    expect(deckListKey('Home', 2, 3)).toEqual({ type: 'select', index: 0 });
    expect(deckListKey('End', 0, 3)).toEqual({ type: 'select', index: 2 });
  });

  it('keeps the deck on Enter, blurs on Escape, and ignores the other keys', () => {
    expect(deckListKey('Enter', 1, 3)).toEqual({ type: 'keep' });
    expect(deckListKey('Escape', 1, 3)).toEqual({ type: 'blur' });
    for (const key of [' ', '1', '2', '3', '4', 'h', 'l', 'Tab', ':']) {
      expect(deckListKey(key, 1, 3)).toEqual({ type: 'none' });
    }
  });

  it('does nothing when the list is empty or the index is not an integer', () => {
    expect(deckListKey('j', 0, 0)).toEqual({ type: 'none' });
    expect(deckListKey('j', 0, 1.5)).toEqual({ type: 'none' });
    expect(deckListKey('End', Number.NaN, 3)).toEqual({ type: 'select', index: 2 });
    expect(deckListKey('ArrowUp', -4, 3)).toEqual({ type: 'select', index: 0 });
  });
});
