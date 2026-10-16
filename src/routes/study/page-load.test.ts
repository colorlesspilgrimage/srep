import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEYBINDS } from '#lib/client/tui/keymap.js';

const { readGallerySettings } = vi.hoisted(() => ({
  readGallerySettings: vi.fn(),
}));

vi.mock('#lib/server/settings/gallery-settings-read.js', () => ({
  readGallerySettings,
}));

vi.mock('#lib/server/db/index.js', () => ({
  getDb: () => ({ dialect: 'sqlite', db: {} }),
}));

import { load } from './+page.server.js';

beforeEach(() => {
  readGallerySettings.mockReset();
  readGallerySettings.mockResolvedValue({
    ok: true,
    themeId: 'phosphor-green',
    keybinds: { ...DEFAULT_KEYBINDS },
  });
});

function caller(): { headers: Headers; input: Parameters<typeof load>[0] } {
  const headers = new Headers();
  const input = {
    setHeaders(value: Record<string, string>) {
      for (const [name, header] of Object.entries(value)) {
        headers.set(name, header);
      }
    },
  } as Parameters<typeof load>[0];
  return { headers, input };
}

describe('study page load', () => {
  it('sets private cache headers and a null theme query', async () => {
    const { headers, input } = caller();
    const page = await load(input);
    expect(headers.get('cache-control')).toBe('no-store');
    expect(headers.get('vary')).toBe('Cookie');
    expect([...headers.keys()].sort()).toEqual(['cache-control', 'vary']);
    expect(page).toEqual({ themeId: 'phosphor-green', keybinds: DEFAULT_KEYBINDS });
    expect(readGallerySettings).toHaveBeenCalledWith(expect.anything(), null);
  });

  it('does not use a corrupt theme as the page theme', async () => {
    readGallerySettings.mockResolvedValue({ ok: false, status: 500, error: 'settings_corrupt' });
    const { headers, input } = caller();
    await expect(load(input)).rejects.toMatchObject({
      status: 500,
      body: { message: 'settings_corrupt' },
    });
    expect(headers.get('cache-control')).toBe('no-store');
    expect(headers.get('vary')).toBe('Cookie');
  });
});
