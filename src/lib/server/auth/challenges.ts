import { fail, type AuthDeps, type Failure } from '#lib/server/auth/deps.js';
import type { ChallengePurpose } from '#lib/server/auth/store.js';
import { randomToken } from '#lib/server/auth/tokens.js';

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export async function createChallenge(
  deps: AuthDeps,
  purpose: ChallengePurpose,
  challenge: string,
): Promise<string> {
  const now = deps.now();
  await deps.store.pruneChallenges(now);
  const id = randomToken(16, deps.random);
  await deps.store.insertChallenge({ id, challenge, purpose, expiresAt: now + CHALLENGE_TTL_MS });
  return id;
}

// The row is used up even when the purpose is wrong or the challenge is old.
export async function takeChallenge(
  deps: AuthDeps,
  id: string,
  purpose: ChallengePurpose,
): Promise<{ ok: true; challenge: string } | Failure> {
  const row = await deps.store.consumeChallenge(id);
  if (row === undefined || row.purpose !== purpose) {
    return fail(400, 'challenge_invalid');
  }
  if (deps.now() >= row.expiresAt) {
    return fail(400, 'challenge_expired');
  }
  return { ok: true, challenge: row.challenge };
}
