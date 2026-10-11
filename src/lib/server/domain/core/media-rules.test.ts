import { describe, expect, it } from 'vitest';
import {
  findMediaTokens,
  isSha256Hex,
  normalizeDeclaredMime,
  sanitizeOriginalName,
  sniffMime,
} from '#lib/server/domain/core/media-rules.js';

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? Array.from(Buffer.from(p)) : p)));

const SIZE = [1, 2, 3, 4];

describe('sniffMime (CWE-434)', () => {
  it.each([
    ['image/png', bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])],
    ['image/jpeg', bytes([0xff, 0xd8, 0xff, 0xe0])],
    ['image/gif', bytes('GIF87a')],
    ['image/gif', bytes('GIF89a')],
    ['image/webp', bytes('RIFF', SIZE, 'WEBP')],
    ['audio/wav', bytes('RIFF', SIZE, 'WAVE')],
    ['audio/ogg', bytes('OggS', [0])],
    ['audio/mpeg', bytes('ID3', [3, 0])],
    ['audio/mpeg', bytes([0xff, 0xfb, 0x90])],
    ['audio/mp4', bytes(SIZE, 'ftypM4A ')],
  ])('finds %s', (mime, data) => {
    expect(sniffMime(data)).toBe(mime);
  });

  it.each([
    ['a wrong first byte', bytes([0x88, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ['a short input', bytes([0x89, 0x50, 0x4e])],
    ['an empty input', bytes()],
    ['RIFF AVI', bytes('RIFF', SIZE, 'AVI LIST')],
    ['SVG', bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ['HTML', bytes('<!doctype html><script>alert(1)</script>')],
    ['a lone 0xff', bytes([0xff])],
  ])('refuses %s', (_name, data) => {
    expect(sniffMime(data)).toBeNull();
  });
});

describe('normalizeDeclaredMime', () => {
  it('lowers the type and drops the parameters', () => {
    expect(normalizeDeclaredMime('Image/PNG; charset=x')).toBe('image/png');
    expect(normalizeDeclaredMime(' audio/ogg ')).toBe('audio/ogg');
  });
});

describe('sanitizeOriginalName', () => {
  it.each([
    ['../../etc/passwd', '.._.._etc_passwd'],
    ['a\\b\\c.png', 'a_b_c.png'],
    ['bad\u0000\n\u007fname', 'bad___name'],
    ['', 'file'],
    ['   ', 'file'],
    ['cafe\u0301.png', 'café.png'],
  ])('%j gives %j', (name, expected) => {
    expect(sanitizeOriginalName(name)).toBe(expected);
  });

  it('cuts a long name to 255 characters', () => {
    expect(sanitizeOriginalName('x'.repeat(300))).toBe('x'.repeat(255));
    expect(Array.from(sanitizeOriginalName('😀'.repeat(300)))).toHaveLength(255);
  });
});

describe('findMediaTokens and isSha256Hex', () => {
  const a = 'a'.repeat(64);
  const b = '0123456789abcdef'.repeat(4);

  it('finds valid tokens, also adjacent ones', () => {
    expect(findMediaTokens(`x {{media:${a}}} y {{media:${b}}}`)).toEqual([a, b]);
    expect(findMediaTokens(`{{media:${a}}}{{media:${b}}}`)).toEqual([a, b]);
  });

  it('keeps malformed tokens as text', () => {
    expect(findMediaTokens(`{{media:${'a'.repeat(63)}}}`)).toEqual([]);
    expect(findMediaTokens(`{{media:${'A'.repeat(64)}}}`)).toEqual([]);
    expect(findMediaTokens(`{{media:${'a'.repeat(65)}}}`)).toEqual([]);
    expect(findMediaTokens(`{{media:${a}}`)).toEqual([]);
    expect(findMediaTokens('{{media:'.repeat(10_000))).toEqual([]);
  });

  it('checks a sha256 hex string (CWE-22)', () => {
    expect(isSha256Hex(a)).toBe(true);
    expect(isSha256Hex('A'.repeat(64))).toBe(false);
    expect(isSha256Hex('a'.repeat(63))).toBe(false);
    expect(isSha256Hex('../../etc/passwd')).toBe(false);
    expect(isSha256Hex(`${a}\n`)).toBe(false);
  });
});
