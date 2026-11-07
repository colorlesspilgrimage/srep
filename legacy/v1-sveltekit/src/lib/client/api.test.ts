import { describe, expect, it, vi } from 'vitest';
import { apiFetch, csrfHeaders, errorCodeOf, rejectedResult, setCsrfToken } from './api.js';

describe('apiFetch', () => {
  it('returns a rejected result and reads an error code', () => {
    expect(rejectedResult()).toEqual({ ok: false, status: 400, error: 'bad_request' });
    expect(errorCodeOf({ error: 'unauthenticated' })).toBe('unauthenticated');
    expect(errorCodeOf({ error: 1 })).toBe('error');
    expect(errorCodeOf(null)).toBe('error');
  });

  it('sends JSON and the CSRF header when a token is set', async () => {
    setCsrfToken('tok');
    const seen: { path: string; init: RequestInit }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      seen.push({ path: String(input), init: init ?? {} });
      return Response.json({ ok: true }, { status: 201 });
    };
    vi.stubGlobal('fetch', fetchImpl);
    const result = await apiFetch<{ ok: boolean }>('/api/notes', {
      method: 'POST',
      body: { fields: ['a'] },
    });
    expect(result).toEqual({ ok: true, status: 201, body: { ok: true } });
    const init = seen[0]?.init;
    expect(seen[0]?.path).toBe('/api/notes');
    const headers = init?.headers;
    if (
      init === undefined ||
      headers === undefined ||
      headers instanceof Headers ||
      Array.isArray(headers)
    ) {
      throw new Error('missing headers');
    }
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ fields: ['a'] }));
    expect(init.credentials).toBe('same-origin');
    expect(headers['x-srep-csrf']).toBe('tok');
    expect(csrfHeaders()).toEqual({ 'x-srep-csrf': 'tok' });
    vi.unstubAllGlobals();
    setCsrfToken(null);
  });

  it('returns the error code, a generic error, and a network error', async () => {
    setCsrfToken(null);
    expect(csrfHeaders()).toEqual({});
    const denied = vi.fn(async () => Response.json({ error: 'unauthenticated' }, { status: 401 }));
    vi.stubGlobal('fetch', denied);
    expect(await apiFetch('/api/notes')).toEqual({
      ok: false,
      status: 401,
      error: 'unauthenticated',
    });
    const html = vi.fn(async () => new Response('<html>', { status: 500 }));
    vi.stubGlobal('fetch', html);
    expect(await apiFetch('/api/notes', { method: 'GET' })).toEqual({
      ok: false,
      status: 500,
      error: 'error',
    });
    const down = vi.fn(async () => Promise.reject(new Error('down')));
    vi.stubGlobal('fetch', down);
    expect(await apiFetch('/api/notes')).toEqual({ ok: false, status: 0, error: 'network_error' });
    vi.unstubAllGlobals();
  });
});
