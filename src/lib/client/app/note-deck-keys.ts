// Contract: deck list keys. Arrow keys, j, k, Home, and End move and stop at the ends.
// Enter keeps the deck. Escape blurs. Space, digits, h, l, and Tab do not change the deck.

export type DeckListEffect =
  { type: 'select'; index: number } | { type: 'keep' } | { type: 'blur' } | { type: 'none' };

function clamp(index: number, length: number): number {
  if (index < 0) {
    return 0;
  }
  if (index > length - 1) {
    return length - 1;
  }
  return index;
}

export function deckListKey(key: string, index: number, length: number): DeckListEffect {
  if (!Number.isInteger(length) || length < 1) {
    return { type: 'none' };
  }
  const current = Number.isInteger(index) ? clamp(index, length) : 0;
  if (key === 'ArrowDown' || key === 'j') {
    return { type: 'select', index: clamp(current + 1, length) };
  }
  if (key === 'ArrowUp' || key === 'k') {
    return { type: 'select', index: clamp(current - 1, length) };
  }
  if (key === 'Home') {
    return { type: 'select', index: 0 };
  }
  if (key === 'End') {
    return { type: 'select', index: length - 1 };
  }
  if (key === 'Enter') {
    return { type: 'keep' };
  }
  if (key === 'Escape') {
    return { type: 'blur' };
  }
  return { type: 'none' };
}
