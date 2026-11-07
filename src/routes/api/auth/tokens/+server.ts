import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listApiTokens } from '#lib/server/auth/api-tokens.js';
import { getAuthContext } from '#lib/server/auth/context.js';

export const GET: RequestHandler = async () => {
  const { deps } = getAuthContext();
  return json({ tokens: await listApiTokens(deps) });
};
