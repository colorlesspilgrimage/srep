import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readBytesLimited } from '#lib/server/domain/http.js';
import { getImportExportDeps } from '#lib/server/import-export/deps.js';
import { dryRunImport } from '#lib/server/import-export/service.js';

export const POST: RequestHandler = async ({ request }) => {
  const deps = getImportExportDeps();
  const bytes = await readBytesLimited(request, deps.importMaxBytes);
  if (bytes === null) {
    return json({ error: 'payload_too_large' }, { status: 413 });
  }
  const contentType = request.headers.get('content-type') ?? 'application/octet-stream';
  const result = await dryRunImport(deps, bytes, contentType);
  if ('error' in result) {
    const status =
      result.error === 'payload_too_large'
        ? 413
        : result.error === 'unknown_format' || result.error === 'bad_archive'
          ? 400
          : 422;
    return json({ error: result.error }, { status });
  }
  return json({ report: result });
};
