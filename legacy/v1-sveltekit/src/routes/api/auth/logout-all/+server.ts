import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext } from '#lib/server/auth/context.js';
import { clearSessionCookie } from '#lib/server/auth/http.js';
import { logoutAll } from '#lib/server/auth/sessions.js';

export const POST: RequestHandler = async ({ cookies }) => {
  const { deps } = getAuthContext();
  await logoutAll(deps);
  clearSessionCookie(cookies, deps.auth);
  return json({ ok: true });
};
