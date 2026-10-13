// Contract: Phosphor Green tokens and WCAG 2.2 contrast checks.

export type ThemeTokens = {
  bg: string;
  fg: string;
  dim: string;
  accent: string;
  good: string;
  warn: string;
  bad: string;
  border: string;
  selection: string;
};

export type Rgb = { red: number; green: number; blue: number };

export const THEME_ID = 'phosphor-green';
export const THEME_NAME = 'Phosphor Green';

// These hex values are choices for this plan. They are not a published standard.
export const PHOSPHOR_GREEN = {
  bg: '#001a00',
  fg: '#5dff5d',
  dim: '#3dcc3d',
  accent: '#d6ff4a',
  good: '#7dffb3',
  warn: '#ffe14a',
  bad: '#ff6b6b',
  border: '#1f8f1f',
  selection: '#0d3d0d',
} as const satisfies ThemeTokens;

export const TEXT_TOKEN_KEYS = ['fg', 'dim', 'accent', 'good', 'warn', 'bad'] as const;

const TEXT_MINIMUM = 4.5;
const BORDER_MINIMUM = 3;

export function parseHex(value: string): Rgb {
  if (!/^#[0-9a-f]{6}$/.test(value)) {
    throw new Error('bad_hex');
  }
  return {
    red: Number.parseInt(value.slice(1, 3), 16),
    green: Number.parseInt(value.slice(3, 5), 16),
    blue: Number.parseInt(value.slice(5, 7), 16),
  };
}

function linearChannel(channel: number): number {
  const s = channel / 255;
  if (s <= 0.04045) {
    return s / 12.92;
  }
  return ((s + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const { red, green, blue } = parseHex(hex);
  return 0.2126 * linearChannel(red) + 0.7152 * linearChannel(green) + 0.0722 * linearChannel(blue);
}

export function contrastRatio(a: string, b: string): number {
  const left = relativeLuminance(a);
  const right = relativeLuminance(b);
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
}

export function meetsContrast(ratio: number, minimum: number): boolean {
  return ratio >= minimum;
}

function contrastOrNull(a: string, b: string): number | null {
  try {
    return contrastRatio(a, b);
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'bad_hex') {
      return null;
    }
    throw error;
  }
}

function notePair(failures: string[], label: string, a: string, b: string, minimum: number): void {
  const ratio = contrastOrNull(a, b);
  if (ratio === null || !meetsContrast(ratio, minimum)) {
    failures.push(label);
  }
}

export function themeContrastFailures(tokens: ThemeTokens): string[] {
  const failures: string[] = [];
  for (const key of TEXT_TOKEN_KEYS) {
    notePair(failures, `${key} on bg`, tokens[key], tokens.bg, TEXT_MINIMUM);
  }
  notePair(failures, 'border on bg', tokens.border, tokens.bg, BORDER_MINIMUM);
  notePair(failures, 'fg on selection', tokens.fg, tokens.selection, TEXT_MINIMUM);
  return failures;
}
