import { readFileSync } from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  TEXT_TOKEN_KEYS,
  XAI_DARK,
  contrastRatio,
  meetsContrast,
  themeContrastFailures,
  type ThemeTokens,
} from './tokens.js';
import {
  DEFAULT_THEME_ID,
  PREMADE_THEMES,
  migrateThemeId,
  themeById,
  themeClass,
  themeIdFromQuery,
} from './themes.js';

const NAMES = ['xAI Dark', 'xAI Light', 'High Contrast'];

const IDS = ['xai-dark', 'xai-light', 'high-contrast'];

describe('PREMADE_THEMES', () => {
  it('PREMADE_THEMES has length 3', () => {
    expect(PREMADE_THEMES).toHaveLength(3);
  });

  it('the name list equals the three display names in order', () => {
    expect(PREMADE_THEMES.map((theme) => theme.name)).toEqual(NAMES);
  });

  it('the id list equals the three catalog ids in order', () => {
    expect(PREMADE_THEMES.map((theme) => theme.id)).toEqual(IDS);
  });

  it('ids are unique', () => {
    const ids = PREMADE_THEMES.map((theme) => theme.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('xAI Dark uses the XAI_DARK object', () => {
    expect(themeById('xai-dark')?.tokens).toBe(XAI_DARK);
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

describe('migrateThemeId', () => {
  it('keeps catalog ids', () => {
    expect(migrateThemeId('xai-dark')).toBe('xai-dark');
    expect(migrateThemeId('xai-light')).toBe('xai-light');
    expect(migrateThemeId('high-contrast')).toBe('high-contrast');
  });

  it('maps legacy light themes to xai-light', () => {
    expect(migrateThemeId('solarized-light')).toBe('xai-light');
    expect(migrateThemeId('gruvbox-light')).toBe('xai-light');
  });

  it('maps legacy dark themes to xai-dark', () => {
    expect(migrateThemeId('phosphor-green')).toBe('xai-dark');
    expect(migrateThemeId('nord')).toBe('xai-dark');
    expect(migrateThemeId('dracula')).toBe('xai-dark');
  });

  it('returns null for unknown ids', () => {
    expect(migrateThemeId('nope')).toBeNull();
    expect(migrateThemeId('not-a-theme')).toBeNull();
  });
});

describe('themeIdFromQuery', () => {
  it('themeIdFromQuery(null) is xai-dark', () => {
    expect(themeIdFromQuery(null)).toBe(DEFAULT_THEME_ID);
    expect(themeIdFromQuery(null)).toBe('xai-dark');
  });

  it('themeIdFromQuery(xai-light) is xai-light', () => {
    expect(themeIdFromQuery('xai-light')).toBe('xai-light');
  });

  it('themeIdFromQuery(nord) migrates to xai-dark', () => {
    expect(themeIdFromQuery('nord')).toBe('xai-dark');
  });

  it.each(['', 'Nord', 'nope', 'nord ', 'phosphor-green\n', '<script>'])(
    'themeIdFromQuery(%j) is xai-dark',
    (value) => {
      expect(themeIdFromQuery(value)).toBe('xai-dark');
    },
  );
});

describe('themeClass', () => {
  it('themeClass(xai-light) is tui-theme-xai-light', () => {
    expect(themeClass('xai-light')).toBe('tui-theme-xai-light');
  });

  it('themeClass(nord) throws bad_theme', () => {
    expect(() => themeClass('nord')).toThrow(new Error('bad_theme'));
  });

  it('themeClass(../x) throws bad_theme', () => {
    expect(() => themeClass('../x')).toThrow(new Error('bad_theme'));
  });
});

describe('theme css', () => {
  it('tui.css declares each xAI Dark token', () => {
    const css = readFileSync(path.join(import.meta.dirname, 'tui.css'), 'utf8');
    const keys = Object.keys(XAI_DARK) as (keyof ThemeTokens)[];
    for (const key of keys) {
      expect(css).toContain(`--tui-${key}: ${XAI_DARK[key]};`);
    }
  });

  it('themes.css declares each theme', () => {
    const css = readFileSync(path.join(import.meta.dirname, 'themes.css'), 'utf8');
    for (const theme of PREMADE_THEMES) {
      expect(css).toContain(`.tui-theme-${theme.id}`);
      const keys = Object.keys(theme.tokens) as (keyof ThemeTokens)[];
      for (const key of keys) {
        expect(css).toContain(`--tui-${key}: ${theme.tokens[key]};`);
      }
    }
  });

  it('fg on selection meets contrast for every theme', () => {
    for (const theme of PREMADE_THEMES) {
      const bar = contrastRatio(theme.tokens.fg, theme.tokens.selection);
      expect(meetsContrast(bar, 3)).toBe(true);
    }
  });

  it('theme css files do not load a remote style', () => {
    for (const name of ['tui.css', 'themes.css']) {
      const css = readFileSync(path.join(import.meta.dirname, name), 'utf8');
      expect(css).not.toMatch(/url\(\s*['"]?https?:/i);
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

  it('a random string returns a catalog id', () => {
    const catalog = new Set(IDS);
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), (value) => {
        return catalog.has(themeIdFromQuery(value));
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
