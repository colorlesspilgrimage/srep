import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEYBINDS,
  PALETTE_CLOSE,
  PALETTE_OPEN,
  PALETTE_OPEN_COLON,
  canonicalizeChord,
  chordFromEvent,
  closeHint,
  commandsFor,
  eventMatches,
  openHint,
  paletteKeyAction,
  parseChord,
  remap,
  type ChordEvent,
  type KeybindMap,
} from './keymap.js';

// Contract: chord parse, match, hints, and remap. No clock and no network.

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const DIGITS = '0123456789'.split('');
const KEYS = [
  ...LETTERS,
  ...DIGITS,
  ':',
  'Escape',
  'ArrowUp',
  'ArrowDown',
  'Enter',
  'Home',
  'End',
  'Tab',
];

const QUIET: ChordEvent = {
  key: 'k',
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
};

function event(patch: Partial<ChordEvent>): ChordEvent {
  return { ...QUIET, ...patch };
}

function state(patch: {
  modalOpen?: boolean;
  paletteOpen?: boolean;
  targetIsField?: boolean;
  binds?: KeybindMap;
}) {
  return {
    modalOpen: patch.modalOpen ?? false,
    paletteOpen: patch.paletteOpen ?? false,
    targetIsField: patch.targetIsField ?? false,
    binds: patch.binds ?? DEFAULT_KEYBINDS,
  };
}

describe('keymap chords', () => {
  it('canonicalizeChord(Ctrl+K) is Ctrl+K and k throws bad_chord', () => {
    expect(canonicalizeChord('Ctrl+K')).toBe('Ctrl+K');
    expect(parseChord('Escape')).toEqual({ modifiers: [], key: 'Escape' });
    expect(() => canonicalizeChord('k')).toThrow(new Error('bad_chord'));
    for (const chord of [
      '',
      ' ',
      'Ctrl+k',
      'Ctrl+Ctrl+K',
      'Alt+Ctrl+K',
      '<script>',
      'Ctrl+',
      'A'.repeat(33),
    ]) {
      expect(() => canonicalizeChord(chord)).toThrow('bad_chord');
    }
  });

  it('eventMatches Ctrl+K for k with ctrl and rejects alt', () => {
    const chord = 'Ctrl+K';
    expect(eventMatches(chord, event({ key: 'k', ctrlKey: true }))).toBe(true);
    expect(eventMatches(chord, event({ key: 'K', ctrlKey: true }))).toBe(true);
    expect(eventMatches(chord, event({ key: 'k', ctrlKey: true, altKey: true }))).toBe(false);
    expect(eventMatches('k', event({ key: 'k' }))).toBe(false);
  });

  it('eventMatches colon when every modifier is false', () => {
    expect(eventMatches(':', event({ key: ':' }))).toBe(true);
    expect(eventMatches(':', event({ key: ':', shiftKey: true }))).toBe(false);
    expect(eventMatches('Escape', event({ key: 'Escape' }))).toBe(true);
  });

  it('openHint and closeHint use the default words', () => {
    expect(openHint('Ctrl+K')).toBe('Ctrl+K palette');
    expect(openHint('Alt+K')).toBe('Alt+K palette');
    expect(closeHint('Escape')).toBe('Esc close');
    expect(closeHint('Tab')).toBe('Tab close');
  });

  it('remap of palette.open to Alt+K blocks a second action', () => {
    const next = remap(DEFAULT_KEYBINDS, PALETTE_OPEN, 'Alt+K');
    expect(next).toEqual({ ...DEFAULT_KEYBINDS, [PALETTE_OPEN]: 'Alt+K' });
    expect(typeof next).not.toBe('string');
    if (typeof next === 'string') {
      return;
    }
    expect(typeof remap(next, PALETTE_CLOSE, 'Alt+K')).toBe('string');
    expect(remap(DEFAULT_KEYBINDS, 'palette.nope', 'Alt+K')).toBe('bad_action');
    expect(remap(DEFAULT_KEYBINDS, PALETTE_OPEN, 'k')).toBe('bad_chord');
    expect(remap(DEFAULT_KEYBINDS, PALETTE_OPEN_COLON, ':')).toEqual(DEFAULT_KEYBINDS);
  });

  it('filter show p keeps Show Panes only', () => {
    expect(commandsFor('show p')).toEqual(['Show Panes']);
    expect(commandsFor('SHOW P')).toEqual(['Show Panes']);
    expect(commandsFor('show')).toEqual([
      'Show Panes',
      'Show List',
      'Show Form',
      'Show Modal',
      'Show Settings',
    ]);
  });

  it('chordFromEvent builds Alt+K and ignores a modifier key', () => {
    expect(chordFromEvent(event({ key: 'k', altKey: true }))).toBe('Alt+K');
    expect(chordFromEvent(event({ key: 'k', ctrlKey: true, shiftKey: true, metaKey: true }))).toBe(
      'Ctrl+Shift+Meta+K',
    );
    expect(chordFromEvent(event({ key: 'Alt', altKey: true }))).toBeNull();
    expect(chordFromEvent(event({ key: ':' }))).toBe(':');
    expect(chordFromEvent(event({ key: 'Escape' }))).toBe('Escape');
  });

  it('paletteKeyAction opens, closes, and leaves a field colon alone', () => {
    const ctrlK = event({ key: 'k', ctrlKey: true });
    expect(paletteKeyAction(ctrlK, state({}))).toBe('open');
    expect(paletteKeyAction(ctrlK, state({ targetIsField: true }))).toBe('open');
    expect(paletteKeyAction(ctrlK, state({ modalOpen: true }))).toBe('none');
    expect(paletteKeyAction(event({ key: ':' }), state({ targetIsField: true }))).toBe('none');
    expect(paletteKeyAction(event({ key: ':' }), state({}))).toBe('open');
    expect(paletteKeyAction(event({ key: 'Escape' }), state({ paletteOpen: true }))).toBe('close');
    expect(paletteKeyAction(event({ key: 'Escape' }), state({}))).toBe('none');
    expect(paletteKeyAction(ctrlK, state({ paletteOpen: true }))).toBe('none');
  });

  it('canonical chords match themselves', () => {
    fc.assert(
      fc.property(
        fc.record({
          ctrl: fc.boolean(),
          alt: fc.boolean(),
          shift: fc.boolean(),
          meta: fc.boolean(),
        }),
        fc.constantFrom(...KEYS),
        (flags, key) => {
          const parts: string[] = [];
          if (flags.ctrl) {
            parts.push('Ctrl');
          }
          if (flags.alt) {
            parts.push('Alt');
          }
          if (flags.shift) {
            parts.push('Shift');
          }
          if (flags.meta) {
            parts.push('Meta');
          }
          parts.push(key);
          const chord = parts.join('+');
          expect(canonicalizeChord(chord)).toBe(chord);
          if (/^[A-Z]$/.test(key) && !flags.shift) {
            expect(
              eventMatches(chord, {
                key: key.toLowerCase(),
                ctrlKey: flags.ctrl,
                altKey: flags.alt,
                shiftKey: false,
                metaKey: flags.meta,
              }),
            ).toBe(true);
          }
        },
      ),
      { seed: 1, numRuns: 100 },
    );
  });
});
