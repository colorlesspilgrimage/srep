import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { NativeManifest } from '#lib/server/import-export/types.js';

const MANIFEST = 'manifest.json';
const mediaPath = (sha: string): string => `media/${sha}`;

export type NativeArchive = {
  manifest: NativeManifest;
  files: Map<string, Buffer>;
};

export function packNativeArchive(manifest: NativeManifest, media: Map<string, Buffer>): Buffer {
  const entries: Record<string, Uint8Array> = {
    [MANIFEST]: strToU8(JSON.stringify(manifest)),
  };
  for (const [sha, bytes] of media) {
    entries[mediaPath(sha)] = bytes;
  }
  return Buffer.from(zipSync(entries, { level: 6 }));
}

export function unpackNativeArchive(bytes: Uint8Array): NativeArchive {
  const zip = unzipSync(bytes);
  const manifestText = zip[MANIFEST];
  if (manifestText === undefined) {
    throw new Error('native_archive_missing_manifest');
  }
  const manifest = JSON.parse(strFromU8(manifestText)) as NativeManifest;
  const files = new Map<string, Buffer>();
  for (const [name, data] of Object.entries(zip)) {
    if (name.startsWith('media/') && name.length > 'media/'.length + 63) {
      const sha = name.slice('media/'.length);
      files.set(sha, Buffer.from(data));
    }
  }
  return { manifest, files };
}

export function unpackZipEntries(bytes: Uint8Array): Map<string, Buffer> {
  const zip = unzipSync(bytes);
  const out = new Map<string, Buffer>();
  for (const [name, data] of Object.entries(zip)) {
    out.set(name, Buffer.from(data));
  }
  return out;
}
