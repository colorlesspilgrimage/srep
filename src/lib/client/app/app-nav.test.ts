import { describe, expect, it } from 'vitest';
import { APP_COMMANDS, commandTarget, NAV_ITEMS, tabKeyIndex } from './app-nav.js';

describe('app nav', () => {
  it('lists Decks and the three commands', () => {
    expect(NAV_ITEMS).toEqual([{ id: 'decks', label: 'Decks', href: '/' }]);
    expect(APP_COMMANDS).toEqual(['Open Decks', 'Open Gallery', 'Open Security']);
  });

  it('maps each command to a fixed path', () => {
    expect(commandTarget('Open Decks')).toBe('/');
    expect(commandTarget('Open Gallery')).toBe('/gallery');
    expect(commandTarget('Open Security')).toBe('/security');
    expect(commandTarget('Show Panes')).toBeNull();
    expect(commandTarget('constructor')).toBeNull();
    expect(commandTarget('toString')).toBeNull();
    expect(commandTarget('__proto__')).toBeNull();
  });

  it('moves tabs with arrows, Home, and End, and ignores other keys', () => {
    expect(tabKeyIndex(3, 1, 'ArrowRight')).toBe(2);
    expect(tabKeyIndex(3, 1, 'ArrowLeft')).toBe(0);
    expect(tabKeyIndex(3, 0, 'ArrowLeft')).toBe(0);
    expect(tabKeyIndex(3, 2, 'ArrowRight')).toBe(2);
    expect(tabKeyIndex(1, 0, 'ArrowRight')).toBe(0);
    expect(tabKeyIndex(3, 1, 'Home')).toBe(0);
    expect(tabKeyIndex(3, 1, 'End')).toBe(2);
    for (const key of ['ArrowDown', 'j', 'k', '1', '2', '3', '4', 'Enter', ' ']) {
      expect(tabKeyIndex(3, 1, key)).toBeNull();
    }
    expect(tabKeyIndex(0, 0, 'Home')).toBeNull();
    expect(tabKeyIndex(3, 1.5, 'ArrowRight')).toBe(1);
  });
});
