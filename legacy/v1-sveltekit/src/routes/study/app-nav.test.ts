import { describe, expect, it } from 'vitest';
import { APP_COMMANDS, commandTarget, NAV_ITEMS, tabKeyIndex } from '#lib/client/app/app-nav.js';

describe('app nav', () => {
  it('lists primary nav items and palette commands', () => {
    expect(NAV_ITEMS.map((item) => item.id)).toEqual([
      'decks',
      'study',
      'browse',
      'stats',
      'settings',
    ]);
    expect(APP_COMMANDS).toContain('Open Stats');
    expect(APP_COMMANDS).toContain('Open Security');
  });

  it('maps each command to a fixed path', () => {
    expect(commandTarget('Open Decks')).toBe('/');
    expect(commandTarget('Open Study')).toBe('/study');
    expect(commandTarget('Open Browse')).toBe('/browse');
    expect(commandTarget('Open Stats')).toBe('/stats');
    expect(commandTarget('Open Settings')).toBe('/settings');
    expect(commandTarget('Open Gallery')).toBe('/gallery');
    expect(commandTarget('Open Security')).toBe('/security');
    expect(commandTarget('Show Panes')).toBeNull();
    expect(commandTarget('constructor')).toBeNull();
    expect(commandTarget('toString')).toBeNull();
    expect(commandTarget('__proto__')).toBeNull();
  });

  it('moves tabs with arrows, Home, and End, and ignores other keys', () => {
    expect(tabKeyIndex(5, 1, 'ArrowRight')).toBe(2);
    expect(tabKeyIndex(5, 1, 'ArrowLeft')).toBe(0);
    expect(tabKeyIndex(5, 0, 'ArrowLeft')).toBe(0);
    expect(tabKeyIndex(5, 4, 'ArrowRight')).toBe(4);
    expect(tabKeyIndex(1, 0, 'ArrowRight')).toBe(0);
    expect(tabKeyIndex(5, 1, 'Home')).toBe(0);
    expect(tabKeyIndex(5, 1, 'End')).toBe(4);
    for (const key of ['ArrowDown', 'j', 'k', '1', '2', '3', '4', 'Enter', ' ']) {
      expect(tabKeyIndex(5, 1, key)).toBeNull();
    }
    expect(tabKeyIndex(0, 0, 'Home')).toBeNull();
    expect(tabKeyIndex(5, 1.5, 'ArrowRight')).toBe(1);
  });
});
