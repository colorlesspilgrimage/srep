// Contract: end the session from the home page.
// Input: everywhere true calls logout-all. False calls logout.
// The CSRF token is cleared after the request.
// This file does not import the passkey package.
import { apiFetch, setCsrfToken } from '#lib/client/api.js';

export async function signOut(everywhere: boolean): Promise<void> {
  const path = everywhere ? '/api/auth/logout-all' : '/api/auth/logout';
  await apiFetch(path, { method: 'POST' });
  setCsrfToken(null);
}
