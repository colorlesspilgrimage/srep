import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readJson } from '#lib/server/auth/http.js';
import { getImportExportDeps } from '#lib/server/import-export/deps.js';
import { applyImport } from '#lib/server/import-export/service.js';
import { z } from 'zod';

const bodySchema = z.object({ importToken: z.string().min(1) });

export const POST: RequestHandler = async ({ request }) => {
  const body = await readJson(request, bodySchema);
  if (!body.ok) {
    return body.response;
  }
  const deps = getImportExportDeps();
  const result = await applyImport(deps, body.data.importToken);
  if (result === 'bad_token') {
    return json({ error: 'bad_token' }, { status: 400 });
  }
  return json({ status: 'ok' });
};
