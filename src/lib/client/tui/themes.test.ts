import { readFileSync } from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
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

  it('the selected state has an fg bar because the fill is near the background', () => {
    const css = readFileSync(path.join(import.meta.dirname, 'tui.css'), 'utf8');
    expect(css).toContain('box-shadow: inset 0 0 0 2px var(--tui-fg)');
    for (const theme of PREMADE_THEMES) {
      const bar = contrastRatio(theme.tokens.fg, theme.tokens.selection);
      expect(meetsContrast(bar, 3)).toBe(true);
    }
  });

  it('theme css files do not load a remote style', () => {
    for (const name of ['tui.css', 'themes.css']) {
      const css = readFileSync(path.join(import.meta.dirname, name), 'utf8');
      expect(css).not.toContain('url(');
      expect(css).not.toContain('@import');
      expect(css).not.toContain('expression(');
      expect(css.toLowerCase()).not.toContain('javascript:');
    }
  });
});

const REJECTED_QUERIES = [
  '',
  'Nord',
  'HIGH-CONTRAST',
  'nord ',
  ' nord',
  'phosphor-green\n',
  'nord\n',
  'nord\r\n',
  'nord\u0000',
  '\u0000nord',
  '<script>',
  '%3Cscript%3E',
  '../x',
  '../../etc/passwd',
  'nord/../../etc/passwd',
  'https://evil.example',
  '//evil.example',
  'javascript:alert(1)',
  'nord;background:url(//evil)',
  'nord{color:red}',
  'ノード',
  'n\u200bord',
  '\ufeffnord',
  'nord\t',
  '\uff4e\uff4f\uff52\uff44',
  'n\u043erd',
  '-nord',
  'nord-',
  'nord--x',
  'a'.repeat(40),
  'a'.repeat(41),
  'undefined',
  'phosphor_green',
  'phosphor.green',
  'tui-theme-nord',
];

describe('theme query attacks', () => {
  it('each catalog id round-trips through the query and the class', () => {
    for (const id of IDS) {
      expect(themeIdFromQuery(id)).toBe(id);
      expect(themeClass(id)).toBe(`tui-theme-${id}`);
    }
  });

  it.each(REJECTED_QUERIES)('themeIdFromQuery rejects %j', (value) => {
    expect(themeIdFromQuery(value)).toBe(DEFAULT_THEME_ID);
    expect(themeIdFromQuery(value)).not.toBe(value);
  });

  it.each(REJECTED_QUERIES)('themeClass rejects %j', (value) => {
    expect(() => themeClass(value)).toThrow(new Error('bad_theme'));
  });

  it('themeIdFromQuery rejects a value that is not a string', () => {
    expect(themeIdFromQuery(undefined as unknown as null)).toBe(DEFAULT_THEME_ID);
    expect(themeIdFromQuery(['nord'] as unknown as string)).toBe(DEFAULT_THEME_ID);
    expect(themeIdFromQuery(['<script>'] as unknown as string)).toBe(DEFAULT_THEME_ID);
  });

  it('a random string returns a catalog id or the default', () => {
    const catalog = new Set(IDS);
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), (value) => {
        const id = themeIdFromQuery(value);
        if (!catalog.has(id)) {
          return false;
        }
        return value === id || id === DEFAULT_THEME_ID;
      }),
      { seed: 1, numRuns: 100 },
    );
  });

  it('themeClass returns a catalog class or throws bad_theme', () => {
    const catalog = new Set(IDS);
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), (value) => {
        try {
          const name = themeClass(value);
          return catalog.has(value) && name === `tui-theme-${value}`;
        } catch (error: unknown) {
          return error instanceof Error && error.message === 'bad_theme';
        }
      }),
      { seed: 1, numRuns: 100 },
    );
  });

  it('the theme files do not store a choice or call the network', () => {
    const root = path.resolve(import.meta.dirname, '../../../..');
    const relative = [
      'src/lib/client/tui/themes.ts',
      'src/lib/client/tui/themes.css',
      'src/lib/client/tui/GalleryShell.svelte',
      'src/lib/client/tui/tui.css',
      'src/routes/gallery/+page.server.ts',
      'src/routes/gallery/+page.svelte',
    ];
    const needles = ['localStorage', 'sessionStorage', 'document.cookie', 'goto(', 'fetch('];
    for (const file of relative) {
      const text = readFileSync(path.join(root, file), 'utf8');
      for (const needle of needles) {
        expect(text, file).not.toContain(needle);
      }
    }
  });
});
