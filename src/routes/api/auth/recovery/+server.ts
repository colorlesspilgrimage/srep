// Contract: GET returns the unused recovery-code count. No regenerate in M5.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext } from '#lib/server/auth/context.js';

export const GET: RequestHandler = async () => {
  const { deps } = getAuthContext();
  const unused = await deps.store.listUnusedRecovery();
  return json({ unusedCount: unused.length });
};
