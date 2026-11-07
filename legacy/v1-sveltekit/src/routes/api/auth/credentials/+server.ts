import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext } from '#lib/server/auth/context.js';
import { listCredentials } from '#lib/server/auth/credentials.js';

export const GET: RequestHandler = async () => {
  const { deps } = getAuthContext();
  return json({ credentials: await listCredentials(deps) });
};
