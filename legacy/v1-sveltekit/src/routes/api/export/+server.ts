import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getImportExportDeps } from '#lib/server/import-export/deps.js';
import { exportArchive } from '#lib/server/import-export/service.js';

const FORMATS = new Set(['native', 'apkg', 'csv', 'tsv', 'text']);

export const GET: RequestHandler = async ({ url }) => {
  const format = url.searchParams.get('format') ?? 'native';
  if (!FORMATS.has(format)) {
    return error(400, 'bad_format');
  }
  const deckId = url.searchParams.get('deckId') ?? undefined;
  const deps = getImportExportDeps();
  const result = await exportArchive(deps, format, deckId);
  if (typeof result === 'object' && 'error' in result) {
    return error(400, result.error);
  }
  const names: Record<string, string> = {
    native: 'srep-export.zip',
    apkg: 'export.apkg',
    csv: 'export.csv',
    tsv: 'export.tsv',
    text: 'export.txt',
  };
  const types: Record<string, string> = {
    native: 'application/zip',
    apkg: 'application/zip',
    csv: 'text/csv',
    tsv: 'text/tab-separated-values',
    text: 'text/plain',
  };
  return new Response(new Uint8Array(result), {
    headers: {
      'content-type': types[format] ?? 'application/octet-stream',
      'content-disposition': `attachment; filename="${names[format] ?? 'export.bin'}"`,
    },
  });
};
