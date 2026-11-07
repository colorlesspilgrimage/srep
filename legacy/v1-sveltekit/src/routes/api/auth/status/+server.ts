import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext } from '#lib/server/auth/context.js';

export const GET: RequestHandler = async ({ locals }) => {
  const { deps } = getAuthContext();
  const setupComplete = await deps.store.isSetupComplete();
  if (locals.session === null) {
    return json({ setupComplete, authenticated: false });
  }
  return json({ setupComplete, authenticated: true, csrfToken: locals.session.csrfToken });
};
