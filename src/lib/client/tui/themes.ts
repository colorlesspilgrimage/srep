// Contract: pre-made theme maps and the gallery theme id rule.
// A query must match the catalog. This blocks CWE-20 and CWE-79.

import { PHOSPHOR_GREEN, type ThemeTokens } from './tokens.js';

export type PremadeTheme = {
  id: string;
  name: string;
  tokens: ThemeTokens;
};

export const DEFAULT_THEME_ID = 'phosphor-green';

const QUERY_ID = /^[a-z0-9-]{1,40}$/;
const CATALOG_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const PREMADE_THEMES: readonly PremadeTheme[] = [
  { id: 'phosphor-green', name: 'Phosphor Green', tokens: PHOSPHOR_GREEN },
  {
    id: 'amber-crt',
    name: 'Amber CRT',
    tokens: {
      bg: '#1a0e00',
      fg: '#ffb000',
      dim: '#c48400',
      accent: '#ffe14a',
      good: '#ffd27a',
      warn: '#ff9a3c',
      bad: '#ff6b4a',
      border: '#8a5a00',
      selection: '#3d2400',
    } satisfies ThemeTokens,
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    tokens: {
      bg: '#002b36',
      fg: '#839496',
      dim: '#7f9095',
      accent: '#2aa198',
      good: '#859900',
      warn: '#b58900',
      bad: '#e56462',
      border: '#657b83',
      selection: '#062f3a',
    } satisfies ThemeTokens,
  },
  {
    id: 'solarized-light',
    name: 'Solarized Light',
    tokens: {
      bg: '#fdf6e3',
      fg: '#586e75',
      dim: '#697373',
      accent: '#2076b3',
      good: '#697800',
      warn: '#8f6c00',
      bad: '#d5312e',
      border: '#657b83',
      selection: '#f0ebda',
    } satisfies ThemeTokens,
  },
  {
    id: 'gruvbox-dark',
    name: 'Gruvbox Dark',
    tokens: {
      bg: '#282828',
      fg: '#ebdbb2',
      dim: '#a89984',
      accent: '#83a598',
      good: '#b8bb26',
      warn: '#fabd2f',
      bad: '#fb533f',
      border: '#7c6f64',
      selection: '#3c3836',
    } satisfies ThemeTokens,
  },
  {
    id: 'gruvbox-light',
    name: 'Gruvbox Light',
    tokens: {
      bg: '#fbf1c7',
      fg: '#3c3836',
      dim: '#665c54',
      accent: '#076678',
      good: '#75700e',
      warn: '#976311',
      bad: '#9d0006',
      border: '#7c6f64',
      selection: '#ebdbb2',
    } satisfies ThemeTokens,
  },
  {
    id: 'nord',
    name: 'Nord',
    tokens: {
      bg: '#2e3440',
      fg: '#d8dee9',
      dim: '#81a1c1',
      accent: '#88c0d0',
      good: '#a3be8c',
      warn: '#ebcb8b',
      bad: '#cf888f',
      border: '#5e81ac',
      selection: '#434c5e',
    } satisfies ThemeTokens,
  },
  {
    id: 'dracula',
    name: 'Dracula',
    tokens: {
      bg: '#282a36',
      fg: '#f8f8f2',
      dim: '#8390b7',
      accent: '#bd93f9',
      good: '#50fa7b',
      warn: '#f1fa8c',
      bad: '#ff5555',
      border: '#6272a4',
      selection: '#44475a',
    } satisfies ThemeTokens,
  },
  {
    id: 'monokai',
    name: 'Monokai',
    tokens: {
      bg: '#272822',
      fg: '#f8f8f2',
      dim: '#918e7e',
      accent: '#66d9ef',
      good: '#a6e22e',
      warn: '#e6db74',
      bad: '#fa4988',
      border: '#75715e',
      selection: '#49483e',
    } satisfies ThemeTokens,
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    tokens: {
      bg: '#1a1b26',
      fg: '#a9b1d6',
      dim: '#9aa5ce',
      accent: '#7aa2f7',
      good: '#9ece6a',
      warn: '#e0af68',
      bad: '#f7768e',
      border: '#606680',
      selection: '#24283b',
    } satisfies ThemeTokens,
  },
  {
    id: 'vt100-white-on-black',
    name: 'VT100 White-on-Black',
    tokens: {
      bg: '#000000',
      fg: '#ffffff',
      dim: '#b3b3b3',
      accent: '#ffffff',
      good: '#ffffff',
      warn: '#ffffff',
      bad: '#ffffff',
      border: '#8c8c8c',
      selection: '#1a1a1a',
    } satisfies ThemeTokens,
  },
  {
    id: 'high-contrast',
    name: 'High Contrast',
    tokens: {
      bg: '#000000',
      fg: '#ffffff',
      dim: '#e6e6e6',
      accent: '#ffff00',
      good: '#00ff00',
      warn: '#ffcc00',
      bad: '#ff5e5e',
      border: '#ffffff',
      selection: '#000080',
    } satisfies ThemeTokens,
  },
];

export function themeById(id: string): PremadeTheme | undefined {
  return PREMADE_THEMES.find((theme) => theme.id === id);
}

function catalogTheme(id: string): PremadeTheme | undefined {
  if (!CATALOG_ID.test(id)) {
    return undefined;
  }
  return themeById(id);
}

export function themeIdFromQuery(value: string | null): string {
  if (value === null || !QUERY_ID.test(value)) {
    return DEFAULT_THEME_ID;
  }
  const theme = catalogTheme(value);
  if (theme === undefined) {
    return DEFAULT_THEME_ID;
  }
  return theme.id;
}

export function themeClass(id: string): string {
  const theme = catalogTheme(id);
  if (theme === undefined) {
    throw new Error('bad_theme');
  }
  return `tui-theme-${theme.id}`;
}
