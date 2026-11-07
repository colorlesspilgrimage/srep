import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/auth/context.js', async () => {
  const { routeState } = await import('#lib/server/auth/test-support/route-support.js');
  return { getAuthContext: () => routeState.ctx };
});
import { doSetup, type Harness } from '#lib/server/auth/test-support/harness.js';
import {
  makeEvent,
  readBody,
  useRouteContext,
} from '#lib/server/auth/test-support/route-support.js';
import { GET } from './+server';

let h: Harness;
afterEach(async () => {
  await h.handle.close();
});

const session = { id: 's', csrfToken: 't', kind: 'cookie' as const };

describe('GET /api/auth/recovery', () => {
  it('returns the unused recovery-code count', async () => {
    ({ h } = await useRouteContext());
    await doSetup(h);
    const { event } = makeEvent('/api/auth/recovery', { method: 'GET', session });
    expect(await readBody(await GET(event))).toEqual({ unusedCount: 10 });
  });
});
