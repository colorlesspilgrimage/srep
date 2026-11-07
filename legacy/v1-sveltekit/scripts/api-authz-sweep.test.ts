import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';
import { handleAuth } from '#lib/server/auth/hook.js';
import { createHarness } from '#lib/server/auth/test-support/harness.js';
import { isPublicApiRoute } from '#lib/server/auth/api-guard.js';

const ORIGIN = 'http://localhost:3000';

function walkApiRoutes(dir: string, prefix: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      walkApiRoutes(full, `${prefix}/${name}`, out);
      continue;
    }
    if (name === '+server.ts') {
      out.push(`/api${prefix}`);
    }
  }
}

function listApiRoutes(): string[] {
  const root = path.resolve('src/routes/api');
  const routes: string[] = [];
  walkApiRoutes(root, '', routes);
  return routes.sort();
}

function makeEvent(routePath: string, method: string): RequestEvent {
  const url = new URL(ORIGIN + routePath);
  return {
    url,
    request: new Request(url, { method }),
    cookies: { get: () => undefined },
    locals: { session: null },
  } as unknown as RequestEvent;
}

describe('API authz sweep', () => {
  it('rejects guests on non-public routes', async () => {
    const h = await createHarness();
    const resolve = vi.fn(async () => new Response('{}', { status: 200 }));
    for (const routePath of listApiRoutes().filter((p) => !p.includes('['))) {
      for (const method of ['GET', 'POST', 'PUT', 'DELETE'] as const) {
        if (isPublicApiRoute(method, routePath)) {
          continue;
        }
        const response = await handleAuth(h.deps, makeEvent(routePath, method), resolve);
        expect(response.status, `${method} ${routePath}`).toBe(401);
      }
    }
    await h.handle.close();
  });
});
