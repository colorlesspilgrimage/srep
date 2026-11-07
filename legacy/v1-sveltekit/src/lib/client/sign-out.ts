import { apiFetch, setCsrfToken } from '#lib/client/api.js';

export async function signOut(everywhere: boolean): Promise<void> {
  const path = everywhere ? '/api/auth/logout-all' : '/api/auth/logout';
  await apiFetch(path, { method: 'POST' });
  setCsrfToken(null);
}
