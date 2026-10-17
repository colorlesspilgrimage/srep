import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEYBINDS } from '#lib/client/tui/keymap.js';
import { privateJson, privatePageHeaders, withPrivateHeaders } from './private-page.js';

const { readGallerySettings } = vi.hoisted(() => ({
  readGallerySettings: vi.fn(),
}));

vi.mock('#lib/server/settings/gallery-settings-read.js', () => ({
  readGallerySettings,
}));

vi.mock('#lib/server/db/index.js', () => ({
  getDb: () => ({ dialect: 'sqlite', db: {} }),
}));

import { load } from '../../../routes/+page.server.js';

beforeEach(() => {
  readGallerySettings.mockReset();
  readGallerySettings.mockResolvedValue({
    ok: true,
    themeId: 'phosphor-green',
    keybinds: { ...DEFAULT_KEYBINDS },
  });
});

describe('private page headers', () => {
  it('tells caches not to store the document', () => {
    expect(privatePageHeaders()).toEqual({ 'cache-control': 'no-store', vary: 'Cookie' });
  });

  it('sets those headers on a JSON body', async () => {
    const response = privateJson({ ok: true }, 200);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('vary')).toBe('Cookie');
    expect(await response.json()).toEqual({ ok: true });
  });

  it('copies those headers onto a rejected body', () => {
    const response = withPrivateHeaders(new Response('no', { status: 400 }));
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('vary')).toBe('Cookie');
  });

  it('the home load sets that header and passes a null theme query', async () => {
    const headers = new Headers();
    const page = await load({
      setHeaders(value: Record<string, string>) {
        for (const [name, header] of Object.entries(value)) {
          headers.set(name, header);
        }
      },
    } as Parameters<typeof load>[0]);
    expect(headers.get('cache-control')).toBe('no-store');
    expect(headers.get('vary')).toBe('Cookie');
    expect([...headers.keys()].sort()).toEqual(['cache-control', 'vary']);
    expect(page).toEqual({ themeId: 'phosphor-green', keybinds: DEFAULT_KEYBINDS });
    expect(readGallerySettings).toHaveBeenCalledWith(expect.anything(), null);
  });

  it('a corrupt saved theme does not become the page theme', async () => {
    readGallerySettings.mockResolvedValue({ ok: false, status: 500, error: 'settings_corrupt' });
    const headers = new Headers();
    const page = load({
      setHeaders(value: Record<string, string>) {
        for (const [name, header] of Object.entries(value)) {
          headers.set(name, header);
        }
      },
    } as Parameters<typeof load>[0]);
    await expect(page).rejects.toMatchObject({
      status: 500,
      body: { message: 'settings_corrupt' },
    });
    expect(headers.get('cache-control')).toBe('no-store');
    expect(headers.get('vary')).toBe('Cookie');
  });
});
