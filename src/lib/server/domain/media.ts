import { fail, type Result } from '#lib/server/auth/deps.js';
import {
  isSha256Hex,
  normalizeDeclaredMime,
  sanitizeOriginalName,
  sniffMime,
} from '#lib/server/domain/core/media-rules.js';
import type { DomainDeps } from '#lib/server/domain/deps.js';
import { newId } from '#lib/server/domain/ids.js';
import type { MediaRow } from '#lib/server/domain/store/store-types.js';
import crypto from 'node:crypto';

export type MediaView = MediaRow & { created: boolean };

export type MediaUpload = { bytes: Buffer; declaredMime: string; originalName: string };

// Order of checks: empty, size, type from magic bytes, declared type (CWE-434, CWE-770).
// The file is written before the row, so a row never points at a missing file.
export async function storeMedia(
  deps: DomainDeps,
  upload: MediaUpload,
): Promise<Result<{ media: MediaView }>> {
  const { bytes } = upload;
  if (bytes.length === 0) {
    return fail(400, 'empty_file');
  }
  if (bytes.length > deps.limits.mediaMaxBytes) {
    return fail(413, 'payload_too_large');
  }
  const mime = sniffMime(bytes);
  if (mime === null) {
    return fail(415, 'unsupported_media_type');
  }
  if (normalizeDeclaredMime(upload.declaredMime) !== mime) {
    return fail(400, 'mime_mismatch');
  }
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  await deps.media.write(sha, bytes);
  const row: MediaRow = {
    id: newId(deps.random),
    sha256: sha,
    mime,
    size: bytes.length,
    originalName: sanitizeOriginalName(upload.originalName),
  };
  const stored = await deps.store.insertMediaIfAbsent(row);
  return { ok: true, media: { ...stored, created: stored.id === row.id } };
}

// An invalid hash never reaches the file system (CWE-22).
export async function readMedia(
  deps: DomainDeps,
  sha: string,
): Promise<Result<{ media: MediaRow; bytes: Buffer }>> {
  if (!isSha256Hex(sha)) {
    return fail(404, 'not_found');
  }
  const media = await deps.store.getMediaBySha(sha);
  if (media === undefined) {
    return fail(404, 'not_found');
  }
  const bytes = await deps.media.read(sha);
  if (bytes === null) {
    return fail(404, 'not_found');
  }
  return { ok: true, media, bytes };
}
