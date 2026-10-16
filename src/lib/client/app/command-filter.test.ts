import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { commandsFor } from '#lib/client/tui/keymap.js';
import { filterCommands, paletteNames } from './command-filter.js';

// Contract: ASCII fold only. I folds. A non-ASCII letter stays.

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'command-filter.ts'),
  'utf8',
);

describe('filterCommands', () => {
  it('does not use toLowerCase', () => {
    expect(source).not.toContain('toLowerCase');
  });

  it('returns no rows for an empty filter', () => {
    expect(filterCommands(['Open Decks'], '')).toEqual([]);
    expect(filterCommands(['Open Decks'], '   ')).toEqual([]);
  });

  it('folds I and leaves a non-ASCII letter unchanged', () => {
    expect(filterCommands(['Item', 'Open'], 'I')).toEqual(['Item']);
    expect(filterCommands(['İstanbul', 'Item'], 'i')).toEqual(['Item']);
    expect(filterCommands(['İstanbul', 'Item'], 'İ')).toEqual(['İstanbul']);
    expect(filterCommands(['Item'], 'İ')).toEqual([]);
  });
});

describe('paletteNames', () => {
  it('uses the gallery list when commands are absent', () => {
    expect(paletteNames('show', undefined)).toEqual(commandsFor('show'));
    expect(paletteNames('show', undefined)).toHaveLength(5);
  });

  it('uses the given list when commands are present', () => {
    expect(paletteNames('open', ['Open Decks', 'Show Panes'])).toEqual(['Open Decks']);
  });

  it('returns no rows for an empty filter', () => {
    expect(paletteNames('', undefined)).toEqual([]);
    expect(paletteNames('  ', ['Open Decks'])).toEqual([]);
  });
});
