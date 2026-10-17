// Contract: POST /api/media as raw bytes. A bad size, type, or body does not call fetch.
// CR, LF, or NUL in the type token does not become a header (CWE-113).
// A name with CR, LF, a slash, or ".." does not become a header (CWE-22, CWE-113).
// This file does not log the file bytes.

import { csrfHeaders, errorCodeOf } from '#lib/client/api.js';

export const MEDIA_MAX_BYTES = 10_485_760;

export const ALLOWED_MEDIA_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'audio/wav',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
] as const;

export const MEDIA_ACCEPT = ALLOWED_MEDIA_TYPES.join(',');

const FILE_NAME = /^[\x20-\x7E]{1,200}$/;
const TYPE_TOKEN = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/;
const SHA = /^[0-9a-f]{64}$/;
const ALLOWED = new Set<string>(ALLOWED_MEDIA_TYPES);

export type MediaUploadFile = {
  size: number;
  type: string;
  name: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

export type MediaUploadResult = { ok: true; sha256: string } | { ok: false; error: string };

export function declaredMediaType(type: string): string {
  const semi = type.indexOf(';');
  const base = (semi === -1 ? type : type.slice(0, semi)).trim().toLowerCase();
  if (!TYPE_TOKEN.test(base)) {
    return '';
  }
  return base;
}

function safeFileName(name: string): boolean {
  if (name.includes('\r') || name.includes('\n') || name.includes('\0')) {
    return false;
  }
  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    return false;
  }
  return FILE_NAME.test(name);
}

export function fileNameHeader(name: string): Record<string, string> {
  if (!safeFileName(name)) {
    return {};
  }
  return { 'x-filename': name };
}

function readSha(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('media' in body)) {
    return null;
  }
  const media = body.media;
  if (typeof media !== 'object' || media === null || !('sha256' in media)) {
    return null;
  }
  return typeof media.sha256 === 'string' && SHA.test(media.sha256) ? media.sha256 : null;
}

function sizeError(size: number): MediaUploadResult | null {
  if (size === 0) {
    return { ok: false, error: 'empty_file' };
  }
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 0) {
    return { ok: false, error: 'bad_request' };
  }
  if (size > MEDIA_MAX_BYTES) {
    return { ok: false, error: 'payload_too_large' };
  }
  return null;
}

function refused(file: MediaUploadFile): MediaUploadResult | null {
  const size = sizeError(file.size);
  if (size !== null) {
    return size;
  }
  if (!ALLOWED.has(declaredMediaType(file.type))) {
    return { ok: false, error: 'unsupported_media_type' };
  }
  return null;
}

export async function uploadMediaFile(
  file: MediaUploadFile,
  fetchImpl: typeof fetch = fetch,
): Promise<MediaUploadResult> {
  const early = refused(file);
  if (early !== null) {
    return early;
  }
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    return { ok: false, error: 'network_error' };
  }
  if (bytes.byteLength !== file.size) {
    return { ok: false, error: 'bad_request' };
  }
  const headers: Record<string, string> = {
    'content-type': declaredMediaType(file.type),
    ...csrfHeaders(),
    ...fileNameHeader(file.name),
  };
  let response: Response;
  try {
    response = await fetchImpl('/api/media', {
      method: 'POST',
      headers,
      body: bytes,
      credentials: 'same-origin',
    });
  } catch {
    return { ok: false, error: 'network_error' };
  }
  const parsed: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    return { ok: false, error: errorCodeOf(parsed) };
  }
  const sha = readSha(parsed);
  return sha === null ? { ok: false, error: 'bad_request' } : { ok: true, sha256: sha };
}
