// Contract: upload one file as raw bytes to POST /api/media.
// A size of 0 or above 10485760 does not call fetch.
// An empty type does not call fetch.
// content-type is file.type with the parameters removed, then lower case.
// x-filename is set only for 1 to 200 bytes from space through tilde.
// A name with CR or LF does not become a header (CWE-113).
// The CSRF header is the same token apiFetch sends.
// This file does not log the file bytes.

import { csrfHeaders } from '#lib/client/api.js';

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
const SHA = /^[0-9a-f]{64}$/;

export type MediaUploadFile = {
  size: number;
  type: string;
  name: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

export type MediaUploadResult = { ok: true; sha256: string } | { ok: false; error: string };

export function declaredMediaType(type: string): string {
  const semi = type.indexOf(';');
  return (semi === -1 ? type : type.slice(0, semi)).trim().toLowerCase();
}

export function fileNameHeader(name: string): Record<string, string> {
  if (name.includes('\r') || name.includes('\n') || !FILE_NAME.test(name)) {
    return {};
  }
  return { 'x-filename': name };
}

function errorCode(body: unknown): string {
  if (typeof body !== 'object' || body === null || !('error' in body)) {
    return 'error';
  }
  return typeof body.error === 'string' ? body.error : 'error';
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

function refused(file: MediaUploadFile): MediaUploadResult | null {
  if (file.size === 0) {
    return { ok: false, error: 'empty_file' };
  }
  if (file.size > MEDIA_MAX_BYTES) {
    return { ok: false, error: 'payload_too_large' };
  }
  if (declaredMediaType(file.type).length === 0) {
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
      body: await file.arrayBuffer(),
      credentials: 'same-origin',
    });
  } catch {
    return { ok: false, error: 'network_error' };
  }
  const parsed: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    return { ok: false, error: errorCode(parsed) };
  }
  const sha = readSha(parsed);
  return sha === null ? { ok: false, error: 'bad_request' } : { ok: true, sha256: sha };
}
