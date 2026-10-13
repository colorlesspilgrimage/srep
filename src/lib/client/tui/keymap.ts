// Contract: gallery chords, hints, and the command list.
// A chord has at most 32 characters. A space is not valid (CWE-20).

export const PALETTE_OPEN = 'palette.open';
export const PALETTE_OPEN_COLON = 'palette.open-colon';
export const PALETTE_CLOSE = 'palette.close';

export const ACTION_IDS = [PALETTE_OPEN, PALETTE_OPEN_COLON, PALETTE_CLOSE] as const;

export type ActionId = (typeof ACTION_IDS)[number];

export type KeybindMap = {
  [PALETTE_OPEN]: string;
  [PALETTE_OPEN_COLON]: string;
  [PALETTE_CLOSE]: string;
};

export const DEFAULT_KEYBINDS: KeybindMap = {
  [PALETTE_OPEN]: 'Ctrl+K',
  [PALETTE_OPEN_COLON]: ':',
  [PALETTE_CLOSE]: 'Escape',
};

const MODIFIER_NAMES = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;
const NAMED_KEYS = ['Escape', 'ArrowUp', 'ArrowDown', 'Enter', 'Home', 'End', 'Tab'] as const;
const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta']);
const MAX_CHORD = 32;

// Ctrl or Meta plus one of these keys closes, reloads, or moves a browser tab.
// Ctrl+K stays allowed. It is the default open chord (CWE-20).
const RESERVED_CHORD_KEYS = new Set([
  'D',
  'F',
  'H',
  'J',
  'L',
  'N',
  'O',
  'P',
  'Q',
  'R',
  'S',
  'T',
  'U',
  'W',
  'Tab',
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
]);

const COMMAND_NAMES = [
  'Show Panes',
  'Show List',
  'Show Form',
  'Show Modal',
  'Show Settings',
] as const;

export type ParsedChord = {
  modifiers: readonly string[];
  key: string;
};

export type ChordEvent = {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
};

export type PaletteAction = 'open' | 'close' | 'none';

export type CaptureKeyEffect = 'pass' | 'cancel' | 'chord';

const CANCEL_PASS_KEYS = new Set(['Tab', 'Enter', ' ']);

export type PaletteState = {
  modalOpen: boolean;
  paletteOpen: boolean;
  binds: KeybindMap;
  targetIsField: boolean;
};

function failChord(): never {
  throw new Error('bad_chord');
}

function isNamedKey(part: string): boolean {
  for (const name of NAMED_KEYS) {
    if (name === part) {
      return true;
    }
  }
  return false;
}

function isChordKey(part: string): boolean {
  if (part === ':') {
    return true;
  }
  if (/^[A-Z]$/.test(part) || /^[0-9]$/.test(part)) {
    return true;
  }
  return isNamedKey(part);
}

function modifierIndex(part: string): number {
  for (let index = 0; index < MODIFIER_NAMES.length; index += 1) {
    if (MODIFIER_NAMES[index] === part) {
      return index;
    }
  }
  return -1;
}

function modifiersOf(parts: string[]): string[] {
  const modifiers = parts.slice(0, -1);
  let previous = -1;
  for (const part of modifiers) {
    const index = modifierIndex(part);
    if (index <= previous) {
      failChord();
    }
    previous = index;
  }
  return modifiers;
}

export function parseChord(input: string): ParsedChord {
  if (input.length < 1 || input.length > MAX_CHORD || /\s/u.test(input)) {
    failChord();
  }
  const parts = input.split('+');
  const key = parts.at(-1) ?? '';
  if (!isChordKey(key) || parts.some((part) => part.length === 0)) {
    failChord();
  }
  return { modifiers: modifiersOf(parts), key };
}

export function canonicalizeChord(input: string): string {
  const parsed = parseChord(input);
  return [...parsed.modifiers, parsed.key].join('+');
}

function modifierSet(modifiers: readonly string[]): Set<string> {
  return new Set(modifiers);
}

function modifiersMatch(event: ChordEvent, modifiers: readonly string[]): boolean {
  const want = modifierSet(modifiers);
  if (event.ctrlKey !== want.has('Ctrl') || event.altKey !== want.has('Alt')) {
    return false;
  }
  return event.shiftKey === want.has('Shift') && event.metaKey === want.has('Meta');
}

// ASCII only. Locale case fold maps ı to I and ſ to S (CWE-176).
function asciiUpper(text: string): string | null {
  if (text.length !== 1) {
    return null;
  }
  const code = text.charCodeAt(0);
  if (code >= 65 && code <= 90) {
    return text;
  }
  if (code >= 97 && code <= 122) {
    return String.fromCharCode(code - 32);
  }
  return null;
}

function asciiLower(text: string): string {
  let folded = '';
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 65 && code <= 90) {
      folded += String.fromCharCode(code + 32);
    } else {
      folded += text.charAt(index);
    }
  }
  return folded;
}

function keyMatches(key: string, eventKey: string): boolean {
  if (/^[A-Z]$/.test(key)) {
    return asciiUpper(eventKey) === key;
  }
  return eventKey === key;
}

export function eventMatches(chord: string, event: ChordEvent): boolean {
  let parsed: ParsedChord;
  try {
    parsed = parseChord(chord);
  } catch (error) {
    if (error instanceof Error && error.message === 'bad_chord') {
      return false;
    }
    throw error;
  }
  if (!modifiersMatch(event, parsed.modifiers)) {
    return false;
  }
  return keyMatches(parsed.key, event.key);
}

export function openHint(chord: string): string {
  return `${chord} palette`;
}

export function closeHint(chord: string): string {
  if (chord === 'Escape') {
    return 'Esc close';
  }
  return `${chord} close`;
}

export function commandsFor(filter: string): string[] {
  const needle = asciiLower(filter.trim());
  return COMMAND_NAMES.filter((name) => asciiLower(name).includes(needle));
}

export function isReservedChord(chord: string): boolean {
  let parsed: ParsedChord;
  try {
    parsed = parseChord(chord);
  } catch (error) {
    if (error instanceof Error && error.message === 'bad_chord') {
      return false;
    }
    throw error;
  }
  if (!RESERVED_CHORD_KEYS.has(parsed.key) || parsed.modifiers.includes('Alt')) {
    return false;
  }
  return parsed.modifiers.includes('Ctrl') || parsed.modifiers.includes('Meta');
}

// A letter, digit, or ":" with no Ctrl, Alt, or Meta is a character shortcut.
// Shift still produces a character (WCAG 2.1.4).
export function isCharacterKeyChord(chord: string): boolean {
  let parsed: ParsedChord;
  try {
    parsed = parseChord(chord);
  } catch (error) {
    if (error instanceof Error && error.message === 'bad_chord') {
      return false;
    }
    throw error;
  }
  if (
    parsed.modifiers.includes('Ctrl') ||
    parsed.modifiers.includes('Alt') ||
    parsed.modifiers.includes('Meta')
  ) {
    return false;
  }
  return parsed.key === ':' || /^[A-Z0-9]$/.test(parsed.key);
}

export function elementIsTextField(tagName: string, editable: boolean): boolean {
  if (editable) {
    return true;
  }
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
}

function isActionId(actionId: string): actionId is ActionId {
  for (const id of ACTION_IDS) {
    if (id === actionId) {
      return true;
    }
  }
  return false;
}

function chordInUse(map: KeybindMap, actionId: ActionId, chord: string): boolean {
  for (const id of ACTION_IDS) {
    if (id !== actionId && map[id] === chord) {
      return true;
    }
  }
  return false;
}

export function remap(map: KeybindMap, actionId: string, chord: string): KeybindMap | string {
  if (!isActionId(actionId)) {
    return 'bad_action';
  }
  let canonical: string;
  try {
    canonical = canonicalizeChord(chord);
  } catch (error) {
    if (error instanceof Error && error.message === 'bad_chord') {
      return 'bad_chord';
    }
    throw error;
  }
  if (isReservedChord(canonical)) {
    return 'reserved_chord';
  }
  if (chordInUse(map, actionId, canonical)) {
    return 'duplicate_chord';
  }
  return { ...map, [actionId]: canonical };
}

// Tab, Enter, and Space stay with the Cancel button. Escape restores the draft.
export function captureKeyEffect(key: string): CaptureKeyEffect {
  if (key === 'Escape') {
    return 'cancel';
  }
  if (CANCEL_PASS_KEYS.has(key)) {
    return 'pass';
  }
  return 'chord';
}

export function chordFromEvent(event: ChordEvent): string | null {
  if (MODIFIER_KEYS.has(event.key)) {
    return null;
  }
  const parts: string[] = [];
  if (event.ctrlKey) {
    parts.push('Ctrl');
  }
  if (event.altKey) {
    parts.push('Alt');
  }
  if (event.shiftKey) {
    parts.push('Shift');
  }
  if (event.metaKey) {
    parts.push('Meta');
  }
  const key = asciiUpper(event.key) ?? event.key;
  parts.push(key);
  return parts.join('+');
}

function fieldBlocksChord(chord: string, inField: boolean): boolean {
  return inField && isCharacterKeyChord(chord);
}

export function paletteKeyAction(event: ChordEvent, state: PaletteState): PaletteAction {
  if (state.modalOpen) {
    return 'none';
  }
  const openChord = state.binds[PALETTE_OPEN];
  const colonChord = state.binds[PALETTE_OPEN_COLON];
  const closeChord = state.binds[PALETTE_CLOSE];
  if (!state.paletteOpen && eventMatches(openChord, event)) {
    if (fieldBlocksChord(openChord, state.targetIsField)) {
      return 'none';
    }
    return 'open';
  }
  if (!state.paletteOpen && eventMatches(colonChord, event) && !state.targetIsField) {
    return 'open';
  }
  if (state.paletteOpen && eventMatches(closeChord, event)) {
    if (fieldBlocksChord(closeChord, state.targetIsField)) {
      return 'none';
    }
    return 'close';
  }
  return 'none';
}
