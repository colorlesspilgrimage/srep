export const SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;
export const TOUCH_INTERVAL_MS = 60 * 1000;

export type SessionTimes = { createdAt: number; lastSeenAt: number; expiresAt: number };
export type SessionState = 'valid' | 'idle_expired' | 'absolute_expired';

export function newSessionTimes(now: number): SessionTimes {
  return { createdAt: now, lastSeenAt: now, expiresAt: now + SESSION_ABSOLUTE_MS };
}

// A session is valid only before each limit. At exactly the limit it is expired.
export function evaluateSession(
  row: Pick<SessionTimes, 'lastSeenAt' | 'expiresAt'>,
  now: number,
): SessionState {
  if (now >= row.expiresAt) {
    return 'absolute_expired';
  }
  if (now >= row.lastSeenAt + SESSION_IDLE_MS) {
    return 'idle_expired';
  }
  return 'valid';
}

export function shouldTouch(row: Pick<SessionTimes, 'lastSeenAt'>, now: number): boolean {
  return now - row.lastSeenAt >= TOUCH_INTERVAL_MS;
}
