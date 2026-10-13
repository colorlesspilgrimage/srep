import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PHOSPHOR_GREEN,
  TEXT_TOKEN_KEYS,
  contrastRatio,
  meetsContrast,
  themeContrastFailures,
  type ThemeTokens,
} from './tokens.js';
import {
  DEFAULT_THEME_ID,
  PREMADE_THEMES,
  themeById,
  themeClass,
  themeIdFromQuery,
} from './themes.js';

const NAMES = [
  'Phosphor Green',
  'Amber CRT',
  'Solarized Dark',
  'Solarized Light',
  'Gruvbox Dark',
  'Gruvbox Light',
  'Nord',
  'Dracula',
  'Monokai',
  'Tokyo Night',
  'VT100 White-on-Black',
  'High Contrast',
];

const IDS = [
  'phosphor-green',
  'amber-crt',
  'solarized-dark',
  'solarized-light',
  'gruvbox-dark',
  'gruvbox-light',
  'nord',
  'dracula',
  'monokai',
  'tokyo-night',
  'vt100-white-on-black',
  'high-contrast',
];

describe('PREMADE_THEMES', () => {
  it('PREMADE_THEMES has length 12', () => {
    expect(PREMADE_THEMES).toHaveLength(12);
  });

  it('the name list equals the twelve display names in order', () => {
    expect(PREMADE_THEMES.map((theme) => theme.name)).toEqual(NAMES);
  });

  it('the id list equals the twelve catalog ids in order', () => {
    expect(PREMADE_THEMES.map((theme) => theme.id)).toEqual(IDS);
  });

  it('ids are unique', () => {
    const ids = PREMADE_THEMES.map((theme) => theme.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('Phosphor Green uses the PHOSPHOR_GREEN object', () => {
    expect(themeById('phosphor-green')?.tokens).toBe(PHOSPHOR_GREEN);
  });

  it('themeContrastFailures of each theme is empty', () => {
    for (const theme of PREMADE_THEMES) {
      expect(themeContrastFailures(theme.tokens)).toEqual([]);
    }
  });

  it('High Contrast text tokens pass 7:1', () => {
    const theme = themeById('high-contrast');
    if (theme === undefined) {
      throw new Error('bad_theme');
    }
    for (const key of TEXT_TOKEN_KEYS) {
      const ratio = contrastRatio(theme.tokens[key], theme.tokens.bg);
      expect(meetsContrast(ratio, 7)).toBe(true);
    }
    const onSelection = contrastRatio(theme.tokens.fg, theme.tokens.selection);
    expect(meetsContrast(onSelection, 7)).toBe(true);
  });
});

describe('themeIdFromQuery', () => {
  it('themeIdFromQuery(null) is phosphor-green', () => {
    expect(themeIdFromQuery(null)).toBe(DEFAULT_THEME_ID);
    expect(themeIdFromQuery(null)).toBe('phosphor-green');
  });

  it('themeIdFromQuery(nord) is nord', () => {
    expect(themeIdFromQuery('nord')).toBe('nord');
  });

  it.each(['', 'Nord', 'nope', 'nord ', 'phosphor-green\n', '<script>'])(
    'themeIdFromQuery(%j) is phosphor-green',
    (value) => {
      expect(themeIdFromQuery(value)).toBe('phosphor-green');
    },
  );
});

describe('themeClass', () => {
  it('themeClass(nord) is tui-theme-nord', () => {
    expect(themeClass('nord')).toBe('tui-theme-nord');
  });

  it('themeClass(../x) throws bad_theme', () => {
    expect(() => themeClass('../x')).toThrow(new Error('bad_theme'));
  });
});

describe('theme css', () => {
  it('tui.css declares each Phosphor Green token', () => {
    const css = readFileSync(path.join(import.meta.dirname, 'tui.css'), 'utf8');
    const keys = Object.keys(PHOSPHOR_GREEN) as (keyof ThemeTokens)[];
    for (const key of keys) {
      expect(css).toContain(`--tui-${key}: ${PHOSPHOR_GREEN[key]};`);
    }
  });

  it('themes.css declares each other theme', () => {
    const css = readFileSync(path.join(import.meta.dirname, 'themes.css'), 'utf8');
    for (const theme of PREMADE_THEMES) {
      if (theme.id === 'phosphor-green') {
        continue;
      }
      expect(css).toContain(`.tui-theme-${theme.id}`);
      const keys = Object.keys(theme.tokens) as (keyof ThemeTokens)[];
      for (const key of keys) {
        expect(css).toContain(`--tui-${key}: ${theme.tokens[key]};`);
      }
    }
  });
});
