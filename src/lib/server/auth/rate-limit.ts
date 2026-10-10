export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSec: number };

export type RateLimiter = {
  /** Counts one call for the key. */
  check: (key: string) => RateLimitResult;
  /** Reads the state for the key. It counts nothing. */
  peek: (key: string) => RateLimitResult;
  reset: (key: string) => void;
};

const PRUNE_AT = 1000;
const MAX_KEYS = 10_000;

type Window = { start: number; count: number };

export function createRateLimiter(opts: {
  limit: number;
  windowMs: number;
  now: () => number;
}): RateLimiter {
  // A Map keeps insertion order, so the first key is the oldest window.
  const windows = new Map<string, Window>();

  function prune(now: number): void {
    for (const [key, win] of windows) {
      if (now - win.start >= opts.windowMs) {
        windows.delete(key);
      }
    }
  }

  function blocked(win: Window, now: number): RateLimitResult {
    const retryMs = win.start + opts.windowMs - now;
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(retryMs / 1000)) };
  }

  return {
    peek(key) {
      const now = opts.now();
      const win = windows.get(key);
      if (win === undefined || now - win.start >= opts.windowMs || win.count < opts.limit) {
        return { allowed: true };
      }
      return blocked(win, now);
    },
    check(key) {
      const now = opts.now();
      if (windows.size > PRUNE_AT) {
        prune(now);
      }
      let win = windows.get(key);
      if (win === undefined || now - win.start >= opts.windowMs) {
        windows.delete(key);
        if (windows.size >= MAX_KEYS) {
          const oldest = windows.keys().next();
          if (oldest.done !== true) {
            windows.delete(oldest.value);
          }
        }
        win = { start: now, count: 0 };
        windows.set(key, win);
      }
      if (win.count >= opts.limit) {
        return blocked(win, now);
      }
      win.count += 1;
      return { allowed: true };
    },
    reset(key) {
      windows.delete(key);
    },
  };
}
