import type { DomainDeps } from '#lib/server/domain/deps.js';
import {
  createDomainHarness,
  type DomainHarness,
} from '#lib/server/domain/test-support/harness.js';

// The route tests mock getDomainContext and read the deps from here.
export const domainRouteState: { deps: DomainDeps | undefined } = { deps: undefined };

export async function useDomainRouteContext(mediaMaxBytes?: number): Promise<DomainHarness> {
  const h = await createDomainHarness(mediaMaxBytes);
  domainRouteState.deps = h.deps;
  return h;
}

export const SESSION = { id: 's', csrfToken: 't' };
export const UNKNOWN_ID = '123e4567-e89b-42d3-a456-426614174000';
