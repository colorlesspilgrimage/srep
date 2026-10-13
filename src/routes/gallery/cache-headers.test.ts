import { describe, expect, it } from 'vitest';
import { load } from './+page.server.js';
import { galleryCacheHeaders } from './cache-headers.js';

function loadGallery(search: string): { headers: Headers; page: ReturnType<typeof load> } {
  const headers = new Headers();
  const page = load({
    setHeaders(value: Record<string, string>) {
      for (const [name, header] of Object.entries(value)) {
        headers.set(name, header);
      }
    },
    url: new URL(`http://127.0.0.1:3000/gallery${search}`),
  } as Parameters<typeof load>[0]);
  return { headers, page };
}

describe('gallery cache headers', () => {
  it('tells caches not to store the gallery document', () => {
    expect(galleryCacheHeaders()['cache-control']).toBe('no-store');
  });

  it('the gallery load sets that header', () => {
    const result = loadGallery('');
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(result.page).toEqual({ themeId: 'phosphor-green' });
  });

  it('the gallery load maps a catalog theme query', () => {
    const result = loadGallery('?theme=nord');
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(result.page).toEqual({ themeId: 'nord' });
  });

  it('the gallery load rejects a theme query that is not a catalog id', () => {
    const result = loadGallery('?theme=%3Cscript%3E');
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(result.page).toEqual({ themeId: 'phosphor-green' });
  });
});
