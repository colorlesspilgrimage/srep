import { unzipSync } from 'fflate';
import type { ImportFormat } from '#lib/server/import-export/types.js';

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && ZIP_MAGIC.every((value, index) => bytes[index] === value);
}

export function detectImportFormat(bytes: Uint8Array, contentType: string): ImportFormat | null {
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (type === 'text/csv' || type === 'application/csv') {
    return 'csv';
  }
  if (type === 'text/tab-separated-values') {
    return 'tsv';
  }
  if (isZip(bytes)) {
    try {
      const zip = unzipSync(bytes);
      if (zip['manifest.json'] !== undefined) {
        return 'native';
      }
      if (
        zip['collection.anki2'] !== undefined ||
        zip['collection.anki21'] !== undefined ||
        zip['collection.anki21b'] !== undefined
      ) {
        return 'apkg';
      }
    } catch {
      return null;
    }
    return 'apkg';
  }
  if (type.includes('csv')) {
    return 'csv';
  }
  if (bytes.length > 0 && (bytes.includes(9) || bytes.includes(44))) {
    const sample = Buffer.from(bytes.slice(0, 512)).toString('utf8');
    if (sample.includes('\t')) {
      return 'tsv';
    }
    if (sample.includes(',')) {
      return 'csv';
    }
  }
  return null;
}
