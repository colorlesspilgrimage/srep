// Contract: listbox key moves. A bad index does not leave this module.
// Arrow keys stop at the ends. Enter selects only a real row.

function clampIndex(length: number, index: number): number {
  const last = length - 1;
  if (!Number.isFinite(index) || index < 0) {
    return 0;
  }
  if (index > last) {
    return last;
  }
  return index;
}

export type ListKeyEffect = 'move' | 'run';

export function listKeyEffect(key: string): ListKeyEffect | null {
  if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
    return 'move';
  }
  if (key === 'Enter') {
    return 'run';
  }
  return null;
}

export function listKeyIndex(length: number, selectedIndex: number, key: string): number | null {
  if (!Number.isInteger(length) || length < 1) {
    return null;
  }
  if (key === 'Home') {
    return 0;
  }
  if (key === 'End') {
    return length - 1;
  }
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    const step = key === 'ArrowDown' ? 1 : -1;
    const base = Number.isInteger(selectedIndex) ? selectedIndex : 0;
    return clampIndex(length, base + step);
  }
  if (key === 'Enter') {
    if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= length) {
      return null;
    }
    return selectedIndex;
  }
  return null;
}
