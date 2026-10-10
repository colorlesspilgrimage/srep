import type { AuthDeps } from '#lib/server/auth/deps.js';
import {
  SESSION_IDLE_MS,
  evaluateSession,
  newSessionTimes,
  shouldTouch,
  SESSION_ABSOLUTE_MS,
} from '#lib/server/auth/session-policy.js';
import type { SessionRow } from '#lib/server/auth/store.js';
import { randomToken, sha256Hex } from '#lib/server/auth/tokens.js';

const USER_AGENT_MAX = 256;

export type NewSession = { row: SessionRow; rawToken: string; maxAgeSec: number };

// Builds the row and the raw token. The raw token is not stored. Only its hash is.
export function buildSession(deps: AuthDeps, userAgent: string): NewSession {
  const rawToken = randomToken(32, deps.random);
  const row: SessionRow = {
    id: crypto.randomUUID(),
    tokenHash: sha256Hex(rawToken),
    ...newSessionTimes(deps.now()),
    userAgent: userAgent.slice(0, USER_AGENT_MAX),
  };
  return { row, rawToken, maxAgeSec: Math.floor(SESSION_ABSOLUTE_MS / 1000) };
}

export async function createSession(
  deps: AuthDeps,
  userAgent: string,
): Promise<{ rawToken: string; maxAgeSec: number }> {
  const { row, rawToken, maxAgeSec } = buildSession(deps, userAgent);
  await deps.store.insertSession(row);
  return { rawToken, maxAgeSec };
}

export async function resolveSession(deps: AuthDeps, rawToken: string): Promise<SessionRow | null> {
  const row = await deps.store.getSessionByTokenHash(sha256Hex(rawToken));
  if (row === undefined) {
    return null;
  }
  const now = deps.now();
  if (evaluateSession(row, now) !== 'valid') {
    await deps.store.deleteSession(row.id);
    return null;
  }
  if (shouldTouch(row, now)) {
    await deps.store.touchSession(row.id, now);
    return { ...row, lastSeenAt: now };
  }
  return row;
}

export function logout(deps: AuthDeps, id: string): Promise<void> {
  return deps.store.deleteSession(id);
}

export function logoutAll(deps: AuthDeps): Promise<void> {
  return deps.store.deleteAllSessions();
}

export function purgeExpired(deps: AuthDeps): Promise<void> {
  return deps.store.deleteExpiredSessions(deps.now(), SESSION_IDLE_MS);
}
