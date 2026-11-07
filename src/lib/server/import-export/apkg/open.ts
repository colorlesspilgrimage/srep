import { decompress } from '@mongodb-js/zstd';
import Database from 'better-sqlite3';
import { unpackZipEntries } from '#lib/server/import-export/zip-archive.js';

const COLLECTION_NAMES = ['collection.anki2', 'collection.anki21', 'collection.anki21b'] as const;

export type ApkgBundle = {
  collection: Buffer;
  entries: Map<string, Buffer>;
  mediaMap: Record<string, string>;
};

async function collectionBytes(entries: Map<string, Buffer>): Promise<Buffer | undefined> {
  for (const name of COLLECTION_NAMES) {
    const data = entries.get(name);
    if (data !== undefined) {
      if (name === 'collection.anki21b') {
        return decompress(data);
      }
      return data;
    }
  }
  return undefined;
}

export async function openApkg(bytes: Uint8Array): Promise<ApkgBundle> {
  const entries = unpackZipEntries(bytes);
  const collection = await collectionBytes(entries);
  if (collection === undefined) {
    throw new Error('apkg_missing_collection');
  }
  const mediaRaw = entries.get('media');
  const mediaMap =
    mediaRaw === undefined ? {} : (JSON.parse(mediaRaw.toString('utf8')) as Record<string, string>);
  return { collection, entries, mediaMap };
}

export function openAnkiDatabase(collection: Buffer): Database.Database {
  return new Database(collection, { readonly: true });
}
