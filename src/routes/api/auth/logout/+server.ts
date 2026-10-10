import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext } from '#lib/server/auth/context.js';
import { clearSessionCookie } from '#lib/server/auth/http.js';
import { logout } from '#lib/server/auth/sessions.js';

export const POST: RequestHandler = async ({ locals, cookies }) => {
  const { deps } = getAuthContext();
  if (locals.session !== null) {
    await logout(deps, locals.session.id);
  }
  clearSessionCookie(cookies, deps.auth);
  return json({ ok: true });
};
