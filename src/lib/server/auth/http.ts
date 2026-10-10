import { json, type Cookies, type RequestEvent } from '@sveltejs/kit';
import type { z } from 'zod';
import { sessionCookieName, sessionCookieOptions } from '#lib/server/auth/cookies.js';
import type { AuthContext } from '#lib/server/auth/context.js';
import type { AuthConfig } from '#lib/server/auth/rp-config.js';
import type { RateLimiter, RateLimitResult } from '#lib/server/auth/rate-limit.js';
import type { Failure } from '#lib/server/auth/deps.js';

const MAX_BODY_BYTES = 64 * 1024;

type Parsed<T> = { ok: true; data: T } | { ok: false; response: Response };

function errorBody(status: number, error: string): Response {
  return json({ error }, { status });
}

// Reads at most MAX_BODY_BYTES. Returns null when the body is larger.
async function readLimited(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) {
    return null;
  }
  if (request.body === null) {
    return '';
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Parses a JSON body with a strict schema. Errors never name schema details.
export async function readJson<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<Parsed<z.output<S>>> {
  const type = request.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) {
    return { ok: false, response: errorBody(415, 'unsupported_media_type') };
  }
  const text = await readLimited(request);
  if (text === null) {
    return { ok: false, response: errorBody(413, 'payload_too_large') };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, response: errorBody(400, 'bad_request') };
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, response: errorBody(400, 'bad_request') };
  }
  return { ok: true, data: parsed.data };
}

export function errorResponse(failure: Failure): Response {
  return errorBody(failure.status, failure.error);
}

function limitResponse(result: RateLimitResult): Response | null {
  if (result.allowed) {
    return null;
  }
  return json(
    { error: 'rate_limited' },
    { status: 429, headers: { 'retry-after': String(result.retryAfterSec) } },
  );
}

// Counts one attempt for the client address.
export function checkAttempts(event: RequestEvent, ctx: AuthContext): Response | null {
  return limitResponse(ctx.limiters.authAttempts.check(event.getClientAddress()));
}

// Reads a failure limiter. It counts nothing.
export function checkBlocked(limiter: RateLimiter, key: string): Response | null {
  return limitResponse(limiter.peek(key));
}

// One attempt at a time for each failure limiter. The next attempt starts only
// after the previous failure is counted. So a parallel burst cannot pass the
// limit before the first failures are counted (CWE-307, CWE-770).
const failureQueues = new WeakMap<RateLimiter, Promise<unknown>>();

// Runs the attempt when the limiter allows it. Counts a failure with the given code.
// Returns a 429 response when the limiter blocks.
export function runLimited<T extends { ok: true }>(
  limiter: RateLimiter,
  key: string,
  code: string,
  attempt: () => Promise<T | Failure>,
): Promise<T | Failure | Response> {
  const previous = failureQueues.get(limiter) ?? Promise.resolve();
  const next = previous.then(async () => {
    const blocked = checkBlocked(limiter, key);
    if (blocked !== null) {
      return blocked;
    }
    const result = await attempt();
    if (!result.ok && result.error === code) {
      limiter.check(key);
    }
    return result;
  });
  failureQueues.set(
    limiter,
    next.catch(() => undefined),
  );
  return next;
}

export function setSessionCookie(
  cookies: Cookies,
  auth: AuthConfig,
  rawToken: string,
  maxAgeSec: number,
): void {
  cookies.set(
    sessionCookieName(auth.secureCookies),
    rawToken,
    sessionCookieOptions(auth.secureCookies, maxAgeSec),
  );
}

export function clearSessionCookie(cookies: Cookies, auth: AuthConfig): void {
  cookies.set(
    sessionCookieName(auth.secureCookies),
    '',
    sessionCookieOptions(auth.secureCookies, 0),
  );
}

export function userAgentOf(event: RequestEvent): string {
  return event.request.headers.get('user-agent') ?? '';
}
