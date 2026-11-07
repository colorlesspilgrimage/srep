import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readMedia, storeMedia } from '#lib/server/domain/media.js';
import { PNG, SVG } from '#lib/server/domain/test-support/fixtures.js';
import {
  createDomainHarness,
  type DomainHarness,
} from '#lib/server/domain/test-support/harness.js';

let h: DomainHarness;
afterEach(async () => {
  await h.close();
});

const sha = crypto.createHash('sha256').update(PNG).digest('hex');
const upload = (bytes: Buffer, declaredMime = 'image/png', originalName = 'dot.png') => ({
  bytes,
  declaredMime,
  originalName,
});

describe('storeMedia', () => {
  it.skipIf(process.platform === 'win32')(
    'stores a PNG under its sha256 with private modes',
    async () => {
      h = await createDomainHarness();
      const result = await storeMedia(h.deps, upload(PNG, 'Image/PNG; x=y'));
      expect(result).toMatchObject({
        ok: true,
        media: {
          sha256: sha,
          mime: 'image/png',
          size: PNG.length,
          originalName: 'dot.png',
          created: true,
        },
      });
      const file = path.join(h.mediaDir, sha.slice(0, 2), sha);
      expect(fs.readFileSync(file)).toEqual(PNG);
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
      expect(fs.readdirSync(path.join(h.mediaDir, 'tmp'))).toEqual([]);
    },
  );

  it('keeps one row and one file for the same bytes', async () => {
    h = await createDomainHarness();
    const first = await storeMedia(h.deps, upload(PNG));
    const second = await storeMedia(h.deps, upload(PNG, 'image/png', 'other.png'));
    expect(second).toMatchObject({ ok: true, media: { created: false, originalName: 'dot.png' } });
    expect(first.ok && second.ok && first.media.id === second.media.id).toBe(true);
    expect(fs.readdirSync(path.join(h.mediaDir, sha.slice(0, 2)))).toEqual([sha]);
    expect(fs.readdirSync(path.join(h.mediaDir, 'tmp'))).toEqual([]);
  });

  it('checks the size limit at the boundary (CWE-770)', async () => {
    h = await createDomainHarness(PNG.length);
    expect(await storeMedia(h.deps, upload(PNG))).toMatchObject({ ok: true });
    const big = Buffer.concat([PNG, Buffer.from([0])]);
    expect(await storeMedia(h.deps, upload(big))).toEqual({
      ok: false,
      status: 413,
      error: 'payload_too_large',
    });
  });

  it('refuses empty files, SVG and a wrong declared type (CWE-434)', async () => {
    h = await createDomainHarness();
    expect(await storeMedia(h.deps, upload(Buffer.alloc(0)))).toMatchObject({
      status: 400,
      error: 'empty_file',
    });
    expect(await storeMedia(h.deps, upload(SVG, 'image/svg+xml'))).toMatchObject({
      status: 415,
      error: 'unsupported_media_type',
    });
    expect(await storeMedia(h.deps, upload(PNG, 'image/jpeg'))).toMatchObject({
      status: 400,
      error: 'mime_mismatch',
    });
  });

  it('stores a path trick in the name as text only (CWE-22)', async () => {
    h = await createDomainHarness();
    const result = await storeMedia(h.deps, upload(PNG, 'image/png', '../../x.png'));
    expect(result).toMatchObject({ ok: true, media: { originalName: '.._.._x.png' } });
    expect(fs.existsSync(path.join(h.mediaDir, '..', 'x.png'))).toBe(false);
    expect(fs.readdirSync(h.mediaDir).sort()).toEqual([sha.slice(0, 2), 'tmp']);
  });
});

describe('readMedia', () => {
  it('returns the bytes and the row', async () => {
    h = await createDomainHarness();
    await storeMedia(h.deps, upload(PNG));
    const result = await readMedia(h.deps, sha);
    expect(result.ok && result.bytes).toEqual(PNG);
    expect(result.ok && result.media.mime).toBe('image/png');
  });

  it.each(['../../etc/passwd', 'A'.repeat(64), 'a'.repeat(63), 'b'.repeat(64)])(
    'gives 404 for %s',
    async (value) => {
      h = await createDomainHarness();
      expect(await readMedia(h.deps, value)).toEqual({
        ok: false,
        status: 404,
        error: 'not_found',
      });
    },
  );

  it('gives 404 when the file is gone', async () => {
    h = await createDomainHarness();
    await storeMedia(h.deps, upload(PNG));
    fs.rmSync(path.join(h.mediaDir, sha.slice(0, 2), sha));
    expect(await readMedia(h.deps, sha)).toMatchObject({ status: 404 });
  });
});
