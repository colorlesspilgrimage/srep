// Contract: display prefs for the app shell. Pure values. No I/O.
// A bad font size or flag does not become a request body (CWE-20).

export type DisplayPrefs = {
  fontSize: number;
  reducedMotion: boolean;
  scanline: boolean;
  cursorBlink: boolean;
};

export const DEFAULT_DISPLAY: DisplayPrefs = {
  fontSize: 16,
  reducedMotion: false,
  scanline: false,
  cursorBlink: false,
};

export const MIN_FONT_SIZE = 12;
export const MAX_FONT_SIZE = 24;

export function copyDisplayPrefs(prefs: DisplayPrefs): DisplayPrefs {
  return {
    fontSize: prefs.fontSize,
    reducedMotion: prefs.reducedMotion,
    scanline: prefs.scanline,
    cursorBlink: prefs.cursorBlink,
  };
}

export function isFontSize(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_FONT_SIZE && value <= MAX_FONT_SIZE;
}

export function parseFontSizeText(raw: string): number | null {
  if (!/^\d{1,2}$/.test(raw)) {
    return null;
  }
  const fontSize = Number(raw);
  if (!isFontSize(fontSize)) {
    return null;
  }
  return fontSize;
}

export function acceptDisplay(input: {
  fontSizeText: string;
  reducedMotion: boolean;
  scanline: boolean;
  cursorBlink: boolean;
}): { ok: true; display: DisplayPrefs } | { ok: false; error: string } {
  const fontSize = parseFontSizeText(input.fontSizeText.trim());
  if (fontSize === null) {
    return { ok: false, error: `Font size must be ${MIN_FONT_SIZE} to ${MAX_FONT_SIZE}.` };
  }
  if (
    typeof input.reducedMotion !== 'boolean' ||
    typeof input.scanline !== 'boolean' ||
    typeof input.cursorBlink !== 'boolean'
  ) {
    return { ok: false, error: 'Display flags must be true or false.' };
  }
  return {
    ok: true,
    display: {
      fontSize,
      reducedMotion: input.reducedMotion,
      scanline: input.scanline,
      cursorBlink: input.cursorBlink,
    },
  };
}

export function parseDisplayBody(body: unknown): DisplayPrefs | null {
  if (typeof body !== 'object' || body === null || !('display' in body)) {
    return null;
  }
  return parseDisplayPrefs(body.display);
}

export function parseDisplayPrefs(value: unknown): DisplayPrefs | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  if (
    !('fontSize' in value) ||
    !('reducedMotion' in value) ||
    !('scanline' in value) ||
    !('cursorBlink' in value)
  ) {
    return null;
  }
  if (typeof value.fontSize !== 'number' || !isFontSize(value.fontSize)) {
    return null;
  }
  if (
    typeof value.reducedMotion !== 'boolean' ||
    typeof value.scanline !== 'boolean' ||
    typeof value.cursorBlink !== 'boolean'
  ) {
    return null;
  }
  return {
    fontSize: value.fontSize,
    reducedMotion: value.reducedMotion,
    scanline: value.scanline,
    cursorBlink: value.cursorBlink,
  };
}

export function displayRootClass(prefs: DisplayPrefs): string {
  // Font size is a class, not a style attr, so CSP style-src-attr stays tight.
  const parts = ['tui-display', `tui-font-${prefs.fontSize}`];
  if (prefs.reducedMotion) {
    parts.push('tui-display-reduced-motion');
  }
  if (prefs.scanline) {
    parts.push('tui-display-scanline');
  }
  if (prefs.cursorBlink) {
    parts.push('tui-display-cursor-blink');
  }
  return parts.join(' ');
}
