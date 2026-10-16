// Contract: the app navigation list and command targets.
// Later slices add items here. The paths are fixed. No user text is encoded.
// tabKeyIndex moves a tab. ArrowDown, j, k, and digits do not move a tab.
// No I/O.

export const NAV_ITEMS = [{ id: 'decks', label: 'Decks', href: '/' }] as const;

export const APP_COMMANDS = ['Open Decks', 'Open Gallery', 'Open Security'] as const;

type CommandPath = '/' | '/gallery' | '/security';

// Own keys only. A name such as "constructor" must not read Object members (CWE-1321).
const TARGETS = new Map<string, CommandPath>([
  ['Open Decks', '/'],
  ['Open Gallery', '/gallery'],
  ['Open Security', '/security'],
]);

export function commandTarget(name: string): CommandPath | null {
  return TARGETS.get(name) ?? null;
}

export function tabKeyIndex(length: number, index: number, key: string): number | null {
  if (!Number.isInteger(length) || length < 1) {
    return null;
  }
  if (key === 'Home') {
    return 0;
  }
  if (key === 'End') {
    return length - 1;
  }
  if (key !== 'ArrowRight' && key !== 'ArrowLeft') {
    return null;
  }
  const step = key === 'ArrowRight' ? 1 : -1;
  const base = Number.isInteger(index) ? index : 0;
  const next = base + step;
  if (next < 0) {
    return 0;
  }
  if (next > length - 1) {
    return length - 1;
  }
  return next;
}
