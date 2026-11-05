// Contract: pre-made theme maps and the gallery theme id rule.
// A query must match the catalog. This blocks CWE-20 and CWE-79.
// Legacy CRT theme ids migrate to xai-dark or xai-light.

import { XAI_DARK, type ThemeTokens } from './tokens.js';

export type PremadeTheme = {
  id: string;
  name: string;
  tokens: ThemeTokens;
};

export const DEFAULT_THEME_ID = 'xai-dark';

const QUERY_ID = /^[a-z0-9-]{1,40}$/;
const CATALOG_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const LEGACY_LIGHT = new Set(['solarized-light', 'gruvbox-light']);

const LEGACY_DARK = new Set([
  'phosphor-green',
  'amber-crt',
  'solarized-dark',
  'gruvbox-dark',
  'nord',
  'dracula',
  'monokai',
  'tokyo-night',
  'vt100-white-on-black',
]);

export const PREMADE_THEMES: readonly PremadeTheme[] = [
  { id: 'xai-dark', name: 'xAI Dark', tokens: XAI_DARK },
  {
    id: 'xai-light',
    name: 'xAI Light',
    tokens: {
      bg: '#f3f6fa',
      fg: '#0c0f14',
      dim: '#5b6b7c',
      accent: '#0f766e',
      good: '#15803d',
      warn: '#a16207',
      bad: '#b91c1c',
      border: '#7a8b9c',
      selection: '#e4ebf3',
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

/**
 * Map a stored or query id onto the current catalog (legacy CRT → xAI).
 * Unknown ids return null so stored settings stay corrupt instead of silent-defaulting.
 */
export function migrateThemeId(id: string): string | null {
  if (themeById(id) !== undefined) {
    return id;
  }
  if (LEGACY_LIGHT.has(id)) {
    return 'xai-light';
  }
  if (LEGACY_DARK.has(id)) {
    return DEFAULT_THEME_ID;
  }
  return null;
}

export function themeIdFromQuery(value: string | null): string {
  if (value === null || !QUERY_ID.test(value)) {
    return DEFAULT_THEME_ID;
  }
  if (!CATALOG_ID.test(value)) {
    return DEFAULT_THEME_ID;
  }
  return migrateThemeId(value) ?? DEFAULT_THEME_ID;
}

export function themeClass(id: string): string {
  if (!CATALOG_ID.test(id)) {
    throw new Error('bad_theme');
  }
  const theme = themeById(id);
  if (theme === undefined) {
    throw new Error('bad_theme');
  }
  return `tui-theme-${theme.id}`;
}
