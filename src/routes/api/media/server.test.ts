import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/domain/context.js', async () => {
  const { domainRouteState } = await import('#lib/server/domain/test-support/route-support.js');
  return { getDomainContext: () => domainRouteState.deps };
});
import { readBody } from '#lib/server/auth/test-support/route-support.js';
import { PNG, SVG } from '#lib/server/domain/test-support/fixtures.js';
import type { DomainHarness } from '#lib/server/domain/test-support/harness.js';
import { useDomainRouteContext } from '#lib/server/domain/test-support/route-support.js';
import { POST as upload } from './+server';
import { GET as download } from './[sha]/+server';

let h: DomainHarness;
afterEach(async () => {
  await h.close();
});

const sha = crypto.createHash('sha256').update(PNG).digest('hex');

function uploadEvent(body: BodyInit, headers: Record<string, string>) {
  const request = new Request('http://localhost:3000/api/media', {
    method: 'POST',
    body,
    headers,
    duplex: 'half',
  } as RequestInit);
  return { request, params: {}, locals: { session: { id: 's', csrfToken: 't' } } } as never;
}

const downloadEvent = (value: string) =>
  ({
    request: new Request(`http://localhost:3000/api/media/${value}`),
    params: { sha: value },
  }) as never;

describe('POST /api/media', () => {
  it('answers 201 for a new file and 200 for the same file again', async () => {
    h = await useDomainRouteContext();
    const first = await upload(
      uploadEvent(PNG, { 'content-type': 'image/png', 'x-filename': 'dot.png' }),
    );
    expect(first.status).toBe(201);
    expect(await readBody(first)).toMatchObject({
      media: {
        sha256: sha,
        mime: 'image/png',
        size: PNG.length,
        originalName: 'dot.png',
        created: true,
      },
    });
    const again = await upload(uploadEvent(PNG, { 'content-type': 'image/png' }));
    expect(again.status).toBe(200);
  });

  it('answers 415, 400 and 413 with the error codes', async () => {
    h = await useDomainRouteContext();
    const svg = await upload(uploadEvent(SVG, { 'content-type': 'image/svg+xml' }));
    expect([svg.status, await readBody(svg)]).toEqual([415, { error: 'unsupported_media_type' }]);
    const wrong = await upload(uploadEvent(PNG, { 'content-type': 'image/gif' }));
    expect([wrong.status, await readBody(wrong)]).toEqual([400, { error: 'mime_mismatch' }]);
    const empty = await upload(uploadEvent(new Uint8Array(0), { 'content-type': 'image/png' }));
    expect(await readBody(empty)).toEqual({ error: 'empty_file' });
    const declared = await upload(
      uploadEvent(PNG, { 'content-type': 'image/png', 'content-length': '999999' }),
    );
    expect([declared.status, await readBody(declared)]).toEqual([
      413,
      { error: 'payload_too_large' },
    ]);
  });

  it('stops reading an over-limit stream early (CWE-400)', async () => {
    h = await useDomainRouteContext(1024);
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(512));
        if (pulled >= 100) {
          controller.close();
        }
      },
    });
    const response = await upload(uploadEvent(stream, { 'content-type': 'image/png' }));
    expect(response.status).toBe(413);
    expect(pulled).toBeLessThan(10);
  });
});

describe('GET /api/media/:sha', () => {
  it('returns the bytes with safe headers', async () => {
    h = await useDomainRouteContext();
    await upload(uploadEvent(PNG, { 'content-type': 'image/png', 'x-filename': 'evil"name.png' }));
    const response = await download(downloadEvent(sha));
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'");
    expect(response.headers.get('content-disposition')).toBe('inline');
    expect(response.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
  });

  it.each(['zzz', '../../etc/passwd', sha.toUpperCase(), 'a'.repeat(64)])(
    'answers 404 for %s',
    async (value) => {
      h = await useDomainRouteContext();
      const response = await download(downloadEvent(value));
      expect(response.status).toBe(404);
      expect(await readBody(response)).toEqual({ error: 'not_found' });
    },
  );
});
