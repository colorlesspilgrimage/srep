import { describe, expect, it } from 'vitest';
import { load } from './+page.server.js';
import { galleryCacheHeaders } from './cache-headers.js';

describe('gallery cache headers', () => {
  it('tells caches not to store the gallery document', () => {
    expect(galleryCacheHeaders()['cache-control']).toBe('no-store');
  });

  it('the gallery load sets that header', () => {
    const headers = new Headers();
    const page = load({
      setHeaders(value: Record<string, string>) {
        for (const [name, header] of Object.entries(value)) {
          headers.set(name, header);
        }
      },
    } as Parameters<typeof load>[0]);
    expect(headers.get('cache-control')).toBe('no-store');
    expect(page).toEqual({});
  });
});
