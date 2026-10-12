import type { AuthContext } from '#lib/server/auth/context.js';
import { createLimiters } from '#lib/server/auth/limiters.js';
import { createHarness, type Harness } from '#lib/server/auth/test-support/harness.js';

// The route tests mock getAuthContext and read the context from here.
export const routeState: { ctx: AuthContext | undefined } = { ctx: undefined };

export type SetCookie = { name: string; value: string; options: Record<string, unknown> };

export async function useRouteContext(
  env: Record<string, string> = {},
): Promise<{ h: Harness; ctx: AuthContext }> {
  const h = await createHarness(env);
  const ctx = { deps: h.deps, limiters: createLimiters(() => h.clock.now) };
  routeState.ctx = ctx;
  return { h, ctx };
}

export type EventOptions = {
  method?: string;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
  params?: Record<string, string>;
  session?: { id: string; csrfToken: string } | null;
  address?: string;
};

// A fake request event. The cookies object records every set call.
export function makeEvent(path: string, opts: EventOptions = {}) {
  const headers: Record<string, string> = { ...opts.headers };
  let body: string | undefined = opts.rawBody;
  if (body === undefined && opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers['content-type'] ??= 'application/json';
  }
  const request = new Request('http://localhost:3000' + path, {
    method: opts.method ?? 'POST',
    headers,
    body,
  });
  const cookiesSet: SetCookie[] = [];
  const event = {
    request,
    url: new URL(request.url),
    params: opts.params ?? {},
    locals: { session: opts.session ?? null },
    getClientAddress: () => opts.address ?? '203.0.113.7',
    cookies: {
      get: () => undefined,
      set: (name: string, value: string, options: Record<string, unknown>) => {
        cookiesSet.push({ name, value, options });
      },
    },
  };
  return { event: event as never, cookiesSet };
}

// Reads a JSON body into the type that the test expects.
export async function readBody<T>(response: Response): Promise<T> {
  return response.json();
}
