import type { AuthDeps } from '#lib/server/auth/deps.js';
import { randomToken, sha256Hex } from '#lib/server/auth/tokens.js';

// Removes all auth data and arms a new setup token. Returns the raw token.
export async function resetAuth(deps: Pick<AuthDeps, 'store' | 'random'>): Promise<string> {
  const token = randomToken(32, deps.random);
  await deps.store.resetAuth({ tokenHash: sha256Hex(token) });
  return token;
}
