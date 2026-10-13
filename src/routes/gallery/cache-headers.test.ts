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
    expect(galleryCacheHeaders().vary).toBe('Cookie');
  });

  it('the gallery load sets that header', () => {
    const result = loadGallery('');
    expectSafePage(result, 'phosphor-green');
  });

  it('the gallery load maps a catalog theme query', () => {
    const result = loadGallery('?theme=nord');
    expectSafePage(result, 'nord');
  });

  it('the gallery load rejects a theme query that is not a catalog id', () => {
    const result = loadGallery('?theme=%3Cscript%3E');
    expectSafePage(result, 'phosphor-green');
  });
});

const REJECTED_SEARCH = [
  '?theme=',
  '?theme=Nord',
  '?theme=HIGH-CONTRAST',
  '?theme=%4Eord',
  '?theme=nord%0a',
  '?theme=nord%0d%0aSet-Cookie:%20evil%3D1',
  '?theme=nord%00',
  '?theme=%00nord',
  '?theme=+nord',
  '?theme=nord%20',
  '?theme=%253Cscript%253E',
  '?theme=..%2F..%2Fetc%2Fpasswd',
  '?theme=%2e%2e%2fpackage.json',
  '?theme=%3Cscript%3E&theme=nord',
  '?theme[]=nord',
  '?theme=nord[]',
  '?Theme=nord',
  '?theme=https://evil.example',
  '?theme=//evil.example',
  '?theme=javascript:alert(1)',
  '?theme=nord%3Bbackground:url(//evil)',
  '?theme=nord%7Bcolor:red%7D',
  '?theme=%E3%83%8E%E3%83%BC%E3%83%89',
  '?theme=n%E2%80%8Bord',
  '?theme=%EF%BB%BFnord',
  '?theme=phosphor-green%0a',
  '?theme=%',
  '?theme=%C0%AF',
  `?theme=${'a'.repeat(80)}`,
];

function expectSafePage(
  result: { headers: Headers; page: ReturnType<typeof load> },
  themeId: string,
): void {
  expect(result.headers.get('cache-control')).toBe('no-store');
  expect(result.headers.get('vary')).toBe('Cookie');
  expect(result.headers.get('location')).toBeNull();
  expect(result.headers.get('set-cookie')).toBeNull();
  expect([...result.headers.keys()].sort()).toEqual(['cache-control', 'vary']);
  expect(result.page).toEqual({ themeId });
  const body = JSON.stringify(result.page);
  expect(body).not.toContain('<');
  expect(body).not.toContain('://');
  expect(body).not.toContain('..');
  expect(body).not.toContain('javascript');
}

describe('gallery theme query attacks', () => {
  it.each(REJECTED_SEARCH)('rejects %s', (search) => {
    expectSafePage(loadGallery(search), 'phosphor-green');
  });

  it('uses the first theme value when the query repeats', () => {
    expectSafePage(loadGallery('?theme=nord&theme=%3Cscript%3E'), 'nord');
    expectSafePage(loadGallery('?theme=%3Cscript%3E&theme=nord'), 'phosphor-green');
  });

  it('accepts a percent-encoded catalog id', () => {
    expectSafePage(loadGallery('?theme=%6eord'), 'nord');
  });
});
