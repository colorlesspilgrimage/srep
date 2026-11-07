import { describe, expect, it } from 'vitest';
import {
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  TOUCH_INTERVAL_MS,
  evaluateSession,
  newSessionTimes,
  shouldTouch,
} from '#lib/server/auth/session-policy.js';

describe('session policy', () => {
  it('makes new session times', () => {
    expect(newSessionTimes(5)).toEqual({
      createdAt: 5,
      lastSeenAt: 5,
      expiresAt: 5 + SESSION_ABSOLUTE_MS,
    });
    expect(SESSION_IDLE_MS).toBe(7 * 24 * 3600 * 1000);
    expect(SESSION_ABSOLUTE_MS).toBe(30 * 24 * 3600 * 1000);
  });

  it('is valid just before the idle limit and expired at it', () => {
    const row = { lastSeenAt: 1000, expiresAt: 1000 + SESSION_ABSOLUTE_MS };
    expect(evaluateSession(row, 1000 + SESSION_IDLE_MS - 1)).toBe('valid');
    expect(evaluateSession(row, 1000 + SESSION_IDLE_MS)).toBe('idle_expired');
  });

  it('expires at the absolute limit even with recent activity', () => {
    const row = {
      lastSeenAt: 1000 + SESSION_ABSOLUTE_MS - 1,
      expiresAt: 1000 + SESSION_ABSOLUTE_MS,
    };
    expect(evaluateSession(row, 1000 + SESSION_ABSOLUTE_MS - 1)).toBe('valid');
    expect(evaluateSession(row, 1000 + SESSION_ABSOLUTE_MS)).toBe('absolute_expired');
  });

  it('touches only after the touch interval', () => {
    expect(shouldTouch({ lastSeenAt: 0 }, TOUCH_INTERVAL_MS - 1)).toBe(false);
    expect(shouldTouch({ lastSeenAt: 0 }, TOUCH_INTERVAL_MS)).toBe(true);
  });
});
