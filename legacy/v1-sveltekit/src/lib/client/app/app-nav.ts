export const NAV_ITEMS = [
  { id: 'decks', label: 'Decks', href: '/', icon: 'decks' },
  { id: 'study', label: 'Study', href: '/study', icon: 'study' },
  { id: 'browse', label: 'Browse', href: '/browse', icon: 'browse' },
  { id: 'stats', label: 'Stats', href: '/stats', icon: 'stats' },
  { id: 'settings', label: 'Settings', href: '/settings', icon: 'settings' },
] as const;

export const APP_COMMANDS = [
  'Open Decks',
  'Open Study',
  'Open Browse',
  'Open Stats',
  'Open Settings',
  'Open Gallery',
  'Open Security',
] as const;

export type NavPath = '/' | '/study' | '/browse' | '/stats' | '/settings';

type CommandPath = NavPath | '/gallery' | '/security';

const TARGETS = new Map<string, CommandPath>([
  ['Open Decks', '/'],
  ['Open Study', '/study'],
  ['Open Browse', '/browse'],
  ['Open Stats', '/stats'],
  ['Open Settings', '/settings'],
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
