import { describe, expect, it, vi } from 'vitest';
import { csrfHeaders, setCsrfToken } from '#lib/client/api.js';
import {
  declaredMediaType,
  fileNameHeader,
  MEDIA_MAX_BYTES,
  uploadMediaFile,
  type MediaUploadFile,
} from './media-upload.js';

const SHA = 'ab'.repeat(32);

function file(extra: Partial<MediaUploadFile> = {}): MediaUploadFile {
  return {
    size: 4,
    type: 'image/png',
    name: 'dot.png',
    arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3, 4]).buffer),
    ...extra,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('media upload headers', () => {
  it('strips type parameters and lower-cases the type', () => {
    expect(declaredMediaType('Image/PNG; charset=utf-8')).toBe('image/png');
    expect(declaredMediaType('  image/gif  ')).toBe('image/gif');
    expect(declaredMediaType('')).toBe('');
  });

  it('sets x-filename only for a short ASCII name', () => {
    expect(fileNameHeader('dot.png')).toEqual({ 'x-filename': 'dot.png' });
    expect(fileNameHeader('a'.repeat(200))).toEqual({ 'x-filename': 'a'.repeat(200) });
    expect(fileNameHeader('a\r\nX-Evil: 1')).toEqual({});
    expect(fileNameHeader('a\nname')).toEqual({});
    expect(fileNameHeader('')).toEqual({});
    expect(fileNameHeader('a'.repeat(201))).toEqual({});
    expect(fileNameHeader('café.png')).toEqual({});
  });
});

describe('uploadMediaFile', () => {
  it('does not call fetch for an empty file, a huge file, or an empty type', async () => {
    const fetchImpl = vi.fn();
    const boom = () => Promise.reject(new Error('read'));
    expect(await uploadMediaFile(file({ size: 0, arrayBuffer: boom }), fetchImpl)).toEqual({
      ok: false,
      error: 'empty_file',
    });
    expect(
      await uploadMediaFile(file({ size: MEDIA_MAX_BYTES + 1, arrayBuffer: boom }), fetchImpl),
    ).toEqual({ ok: false, error: 'payload_too_large' });
    expect(
      await uploadMediaFile(file({ type: ' ; charset=utf-8', arrayBuffer: boom }), fetchImpl),
    ).toEqual({
      ok: false,
      error: 'unsupported_media_type',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends bytes, the CSRF header, and a safe file name', async () => {
    setCsrfToken('tok');
    const seen: { path: string; init: RequestInit }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      seen.push({ path: String(input), init: init ?? {} });
      return jsonResponse(201, { media: { sha256: SHA } });
    };
    const result = await uploadMediaFile(
      file({ size: MEDIA_MAX_BYTES, type: 'image/png; x=1' }),
      fetchImpl,
    );
    expect(result).toEqual({ ok: true, sha256: SHA });
    const init = seen[0]?.init;
    const headers = init?.headers;
    if (headers === undefined || headers instanceof Headers || Array.isArray(headers)) {
      throw new Error('missing headers');
    }
    expect(seen[0]?.path).toBe('/api/media');
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('same-origin');
    expect(headers['content-type']).toBe('image/png');
    expect(headers['x-srep-csrf']).toBe('tok');
    expect(headers['x-filename']).toBe('dot.png');
    expect(csrfHeaders()).toEqual({ 'x-srep-csrf': 'tok' });
    setCsrfToken(null);
  });

  it('omits the file name header and the CSRF header when they are absent', async () => {
    setCsrfToken(null);
    const seen: RequestInit[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      seen.push(init ?? {});
      return jsonResponse(200, { media: { sha256: SHA } });
    };
    await uploadMediaFile(file({ name: 'bad\nname.png' }), fetchImpl);
    const headers = seen[0]?.headers;
    if (headers === undefined || headers instanceof Headers || Array.isArray(headers)) {
      throw new Error('missing headers');
    }
    expect(headers['x-filename']).toBeUndefined();
    expect(headers['x-srep-csrf']).toBeUndefined();
  });

  it('returns the server error, a network error, or a bad body', async () => {
    const denied = vi.fn(async () => jsonResponse(400, { error: 'mime_mismatch' }));
    expect(await uploadMediaFile(file(), denied)).toEqual({ ok: false, error: 'mime_mismatch' });
    const broken = vi.fn(async () => new Response('nope', { status: 500 }));
    expect(await uploadMediaFile(file(), broken)).toEqual({ ok: false, error: 'error' });
    const down = vi.fn(async () => Promise.reject(new Error('down')));
    expect(await uploadMediaFile(file(), down)).toEqual({ ok: false, error: 'network_error' });
    const odd = vi.fn(async () => jsonResponse(200, { media: { sha256: 'ZZ' } }));
    expect(await uploadMediaFile(file(), odd)).toEqual({ ok: false, error: 'bad_request' });
    const missing = vi.fn(async () => jsonResponse(200, { media: { sha256: 1 } }));
    expect(await uploadMediaFile(file(), missing)).toEqual({ ok: false, error: 'bad_request' });
    const empty = vi.fn(async () => jsonResponse(200, {}));
    expect(await uploadMediaFile(file(), empty)).toEqual({ ok: false, error: 'bad_request' });
    const textError = vi.fn(async () => jsonResponse(400, { error: 5 }));
    expect(await uploadMediaFile(file(), textError)).toEqual({ ok: false, error: 'error' });
  });
});
