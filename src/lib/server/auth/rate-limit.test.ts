import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '#lib/server/auth/rate-limit.js';

function make(limit = 3, windowMs = 1000) {
  const clock = { now: 10_000 };
  return { clock, limiter: createRateLimiter({ limit, windowMs, now: () => clock.now }) };
}

describe('createRateLimiter', () => {
  it('allows N calls and blocks call N+1', () => {
    const { limiter } = make();
    for (let i = 0; i < 3; i += 1) {
      expect(limiter.check('a')).toEqual({ allowed: true });
    }
    const blocked = limiter.check('a');
    expect(blocked.allowed).toBe(false);
    expect(blocked.allowed === false && blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it('opens again exactly at the window end', () => {
    const { limiter, clock } = make(1, 1000);
    limiter.check('a');
    clock.now += 999;
    expect(limiter.check('a').allowed).toBe(false);
    clock.now += 1;
    expect(limiter.check('a').allowed).toBe(true);
  });

  it('rounds the retry time up to whole seconds', () => {
    const { limiter, clock } = make(1, 1500);
    limiter.check('a');
    clock.now += 1;
    expect(limiter.check('a')).toEqual({ allowed: false, retryAfterSec: 2 });
  });

  it('keeps keys apart and resets one key', () => {
    const { limiter } = make(1);
    limiter.check('a');
    expect(limiter.check('b').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);
    limiter.reset('a');
    expect(limiter.check('a').allowed).toBe(true);
  });

  it('release gives back one call in the current window only', () => {
    const { limiter, clock } = make(1, 1000);
    limiter.release('a');
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);
    limiter.release('a');
    expect(limiter.check('a').allowed).toBe(true);
    limiter.release('a');
    limiter.release('a');
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);
    clock.now += 1000;
    limiter.release('a');
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);
  });

  it('prunes old keys and caps the map without an error', () => {
    const { limiter, clock } = make(1, 1000);
    for (let i = 0; i < 1500; i += 1) {
      limiter.check(`k${i}`);
    }
    clock.now += 2000;
    expect(limiter.check('fresh').allowed).toBe(true);
    for (let i = 0; i < 10_500; i += 1) {
      limiter.check(`c${i}`);
    }
    expect(limiter.check('c10499').allowed).toBe(false);
    expect(limiter.check('c0').allowed).toBe(true);
  });
});
