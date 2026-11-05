// Contract: the settings JSON client for theme, keybinds, study day, and display.
// Theme ids leave only after the catalog check. Study and display bodies leave
// after accept helpers. A failed check does not call fetch. No shell command is built.

import { apiFetch, rejectedResult, type ApiResult } from '#lib/client/api.js';
import { themeById } from '#lib/client/tui/themes.js';
import type { KeybindMap } from '#lib/client/tui/keymap.js';
import { acceptDisplay, type DisplayPrefs } from './display-prefs.js';
import { acceptStudyDay, type StudyDaySettings } from './study-day-form.js';

type FetchJson = <T>(
  path: string,
  init?: { method?: string; body?: unknown },
) => Promise<ApiResult<T>>;

export function createSettingsClient(fetchJson: FetchJson = apiFetch) {
  return {
    getTheme() {
      return fetchJson<{ id: string }>('/api/settings/theme');
    },
    putTheme(id: string) {
      if (themeById(id) === undefined) {
        return Promise.resolve(rejectedResult());
      }
      return fetchJson<{ id: string }>('/api/settings/theme', {
        method: 'PUT',
        body: { id },
      });
    },
    getKeybinds() {
      return fetchJson<{ keybinds: KeybindMap }>('/api/settings/keybinds');
    },
    putKeybinds(keybinds: KeybindMap) {
      return fetchJson<{ keybinds: KeybindMap }>('/api/settings/keybinds', {
        method: 'PUT',
        body: keybinds,
      });
    },
    getStudy() {
      return fetchJson<{ settings: StudyDaySettings }>('/api/settings/study');
    },
    putStudy(input: { timezone: string; rolloverText: string }) {
      const accepted = acceptStudyDay(input);
      if (!accepted.ok) {
        return Promise.resolve(rejectedResult());
      }
      return fetchJson<{ settings: StudyDaySettings }>('/api/settings/study', {
        method: 'PUT',
        body: accepted.settings,
      });
    },
    getDisplay() {
      return fetchJson<{ display: DisplayPrefs }>('/api/settings/display');
    },
    putDisplay(input: {
      fontSizeText: string;
      reducedMotion: boolean;
      scanline: boolean;
      cursorBlink: boolean;
    }) {
      const accepted = acceptDisplay(input);
      if (!accepted.ok) {
        return Promise.resolve(rejectedResult());
      }
      return fetchJson<{ display: DisplayPrefs }>('/api/settings/display', {
        method: 'PUT',
        body: accepted.display,
      });
    },
  };
}

export type SettingsClient = ReturnType<typeof createSettingsClient>;
