import { createRateLimiter, type RateLimiter } from '#lib/server/auth/rate-limit.js';

export type AuthLimiters = {
  /** Every unauthenticated auth route, per client address. */
  authAttempts: RateLimiter;
  /** Bad setup tokens. One global key, because there is one account. */
  setupTokenFailures: RateLimiter;
  /** Bad recovery codes. One global key. */
  recoveryFailures: RateLimiter;
};

export const SETUP_FAILURE_KEY = 'setup';
export const RECOVERY_FAILURE_KEY = 'recovery';

const MINUTE_MS = 60 * 1000;

export function createLimiters(now: () => number): AuthLimiters {
  return {
    authAttempts: createRateLimiter({ limit: 20, windowMs: 5 * MINUTE_MS, now }),
    setupTokenFailures: createRateLimiter({ limit: 5, windowMs: 15 * MINUTE_MS, now }),
    recoveryFailures: createRateLimiter({ limit: 5, windowMs: 15 * MINUTE_MS, now }),
  };
}
