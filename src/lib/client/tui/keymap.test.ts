import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEYBINDS,
  PALETTE_CLOSE,
  PALETTE_OPEN,
  PALETTE_OPEN_COLON,
  canonicalizeChord,
  captureKeyEffect,
  chordFromEvent,
  closeHint,
  commandsFor,
  elementIsTextField,
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

function cancelKeysStayOnTheButton(): void {
  expect(captureKeyEffect('Tab')).toBe('pass');
  expect(captureKeyEffect('Enter')).toBe('pass');
  expect(captureKeyEffect(' ')).toBe('pass');
  expect(captureKeyEffect('Escape')).toBe('cancel');
  expect(captureKeyEffect('k')).toBe('chord');
  expect(captureKeyEffect('Alt')).toBe('chord');
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

  it('does not match a non-ASCII letter to an ASCII chord', () => {
    expect(eventMatches('I', event({ key: 'ı' }))).toBe(false);
    expect(eventMatches('Ctrl+I', event({ key: 'ı', ctrlKey: true }))).toBe(false);
    expect(eventMatches('S', event({ key: 'ſ' }))).toBe(false);
    expect(eventMatches('I', event({ key: 'i' }))).toBe(true);
    expect(eventMatches('I', event({ key: 'I' }))).toBe(true);
  });

  it('a character chord does not run in a text field', () => {
    const binds: KeybindMap = {
      ...DEFAULT_KEYBINDS,
      [PALETTE_OPEN]: 'K',
      [PALETTE_CLOSE]: 'J',
    };
    expect(paletteKeyAction(event({ key: 'k' }), state({ binds, targetIsField: true }))).toBe(
      'none',
    );
    expect(paletteKeyAction(event({ key: 'k' }), state({ binds }))).toBe('open');
    const shiftBinds: KeybindMap = { ...DEFAULT_KEYBINDS, [PALETTE_OPEN]: 'Shift+K' };
    const shiftK = event({ key: 'K', shiftKey: true });
    expect(paletteKeyAction(shiftK, state({ binds: shiftBinds, targetIsField: true }))).toBe(
      'none',
    );
    expect(paletteKeyAction(shiftK, state({ binds: shiftBinds }))).toBe('open');
    const altBinds: KeybindMap = { ...DEFAULT_KEYBINDS, [PALETTE_OPEN]: 'Alt+K' };
    expect(
      paletteKeyAction(
        event({ key: 'k', altKey: true }),
        state({ binds: altBinds, targetIsField: true }),
      ),
    ).toBe('open');
    expect(
      paletteKeyAction(
        event({ key: 'j' }),
        state({ binds, paletteOpen: true, targetIsField: true }),
      ),
    ).toBe('none');
    expect(paletteKeyAction(event({ key: 'j' }), state({ binds, paletteOpen: true }))).toBe(
      'close',
    );
    expect(
      paletteKeyAction(event({ key: 'Escape' }), state({ paletteOpen: true, targetIsField: true })),
    ).toBe('close');
  });

  it('the colon chord does not run while the palette is open', () => {
    expect(paletteKeyAction(event({ key: ':' }), state({ paletteOpen: true }))).toBe('none');
    expect(
      paletteKeyAction(event({ key: ':' }), state({ paletteOpen: true, targetIsField: true })),
    ).toBe('none');
  });

  it('remap rejects a browser or OS chord and keeps Ctrl+K', () => {
    expect(remap(DEFAULT_KEYBINDS, PALETTE_OPEN, 'Ctrl+W')).toBe('reserved_chord');
    expect(remap(DEFAULT_KEYBINDS, PALETTE_OPEN, 'Ctrl+Shift+W')).toBe('reserved_chord');
    expect(remap(DEFAULT_KEYBINDS, PALETTE_OPEN, 'Meta+Q')).toBe('reserved_chord');
    expect(remap(DEFAULT_KEYBINDS, PALETTE_OPEN, 'Ctrl+1')).toBe('reserved_chord');
    expect(remap(DEFAULT_KEYBINDS, PALETTE_OPEN, 'Ctrl+Tab')).toBe('reserved_chord');
    expect(remap(DEFAULT_KEYBINDS, PALETTE_CLOSE, 'Ctrl+F')).toBe('reserved_chord');
    expect(remap(DEFAULT_KEYBINDS, PALETTE_OPEN, 'Ctrl+K')).toEqual(DEFAULT_KEYBINDS);
    expect(remap(DEFAULT_KEYBINDS, PALETTE_OPEN, 'Alt+W')).toEqual({
      ...DEFAULT_KEYBINDS,
      [PALETTE_OPEN]: 'Alt+W',
    });
  });

  it('a content editable node is a text field', () => {
    expect(elementIsTextField('DIV', true)).toBe(true);
    expect(elementIsTextField('INPUT', false)).toBe(true);
    expect(elementIsTextField('TEXTAREA', false)).toBe(true);
    expect(elementIsTextField('SELECT', false)).toBe(true);
    expect(elementIsTextField('DIV', false)).toBe(false);
    expect(elementIsTextField('BUTTON', false)).toBe(false);
  });

  it('Tab, Enter, and Space stay on Cancel, and Escape cancels', cancelKeysStayOnTheButton);
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
