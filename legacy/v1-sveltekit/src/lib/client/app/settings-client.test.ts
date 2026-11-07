import { describe, expect, it } from 'vitest';
import type { ApiResult } from '#lib/client/api.js';
import { DEFAULT_KEYBINDS } from '#lib/client/tui/keymap.js';
import { createSettingsClient } from './settings-client.js';

function calls() {
  const seen: { path: string; init?: { method?: string; body?: unknown } }[] = [];
  const fetchJson = async <T>(
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<ApiResult<T>> => {
    seen.push({ path, init });
    return { ok: true, status: 200, body: {} as T };
  };
  return { seen, fetchJson };
}

describe('createSettingsClient', () => {
  it('does not fetch a bad theme id, study body, or display body', async () => {
    const { seen, fetchJson } = calls();
    const client = createSettingsClient(fetchJson);
    expect(await client.putTheme('<script>')).toMatchObject({ ok: false, status: 400 });
    expect(await client.putTheme('nope')).toMatchObject({ ok: false, status: 400 });
    expect(await client.putStudy({ timezone: 'Mars/Base', rolloverText: '4' })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(await client.putStudy({ timezone: 'UTC', rolloverText: '99' })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(
      await client.putDisplay({
        fontSizeText: '99',
        reducedMotion: false,
        scanline: false,
        cursorBlink: false,
      }),
    ).toMatchObject({ ok: false, status: 400 });
    expect(seen).toEqual([]);
  });

  it('sends theme, keybinds, study, and display bodies', async () => {
    const { seen, fetchJson } = calls();
    const client = createSettingsClient(fetchJson);
    await client.getTheme();
    await client.putTheme('xai-light');
    await client.getKeybinds();
    await client.putKeybinds(DEFAULT_KEYBINDS);
    await client.getStudy();
    await client.putStudy({ timezone: 'Europe/Berlin', rolloverText: '6' });
    await client.getDisplay();
    await client.putDisplay({
      fontSizeText: '18',
      reducedMotion: true,
      scanline: true,
      cursorBlink: false,
    });
    expect(seen).toEqual([
      { path: '/api/settings/theme', init: undefined },
      { path: '/api/settings/theme', init: { method: 'PUT', body: { id: 'xai-light' } } },
      { path: '/api/settings/keybinds', init: undefined },
      { path: '/api/settings/keybinds', init: { method: 'PUT', body: DEFAULT_KEYBINDS } },
      { path: '/api/settings/study', init: undefined },
      {
        path: '/api/settings/study',
        init: { method: 'PUT', body: { timezone: 'Europe/Berlin', rolloverHour: 6 } },
      },
      { path: '/api/settings/display', init: undefined },
      {
        path: '/api/settings/display',
        init: {
          method: 'PUT',
          body: {
            fontSize: 18,
            reducedMotion: true,
            scanline: true,
            cursorBlink: false,
          },
        },
      },
    ]);
  });
});
