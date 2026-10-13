import { afterEach, describe, expect, it, vi } from 'vitest';

const { routeState } = vi.hoisted(() => ({
  routeState: { handle: undefined as unknown },
}));

vi.mock('#lib/server/db/index.js', () => ({
  getDb: () => {
    if (routeState.handle === undefined) {
      throw new Error('no database');
    }
    return routeState.handle;
  },
}));

import { makeEvent, readBody } from '#lib/server/auth/test-support/route-support.js';
import { SESSION as session } from '#lib/server/domain/test-support/route-support.js';
import {
  createDomainHarness,
  type DomainHarness,
} from '#lib/server/domain/test-support/harness.js';
import { GET, PUT } from './+server';

// Contract: GET and PUT /api/settings/theme. A bad body does not replace a good id.

let h: DomainHarness;

afterEach(async () => {
  await h.close();
});

async function openRoute(): Promise<void> {
  h = await createDomainHarness();
  routeState.handle = h.handle;
}

const read = () => GET(makeEvent('/api/settings/theme', { method: 'GET', session }).event);

const write = (body: unknown) =>
  PUT(makeEvent('/api/settings/theme', { method: 'PUT', body, session }).event);

describe('/api/settings/theme', () => {
  it('returns phosphor-green when the row is absent', async () => {
    await openRoute();
    expect(await readBody(await read())).toEqual({ id: 'phosphor-green' });
  });

  it('stores nord and the next GET returns the same object', async () => {
    await openRoute();
    const response = await write({ id: 'nord' });
    expect(response.status).toBe(200);
    expect(await readBody(response)).toEqual({ id: 'nord' });
    expect(await readBody(await read())).toEqual({ id: 'nord' });
  });

  it('refuses a bad body with 400', async () => {
    await openRoute();
    for (const body of [{ id: 'nope' }, { id: 'nord', extra: true }, {}, { id: 1 }]) {
      const response = await write(body);
      expect(response.status).toBe(400);
      expect(await readBody(response)).toEqual({ error: 'bad_request' });
    }
  });

  it('returns 413 when the body is over the limit', async () => {
    await openRoute();
    const rawBody = 'x'.repeat(70000);
    const { event } = makeEvent('/api/settings/theme', {
      method: 'PUT',
      rawBody,
      headers: { 'content-type': 'application/json' },
      session,
    });
    const response = await PUT(event);
    expect(response.status).toBe(413);
  });

  it('keeps the last good id after a bad PUT', async () => {
    await openRoute();
    expect((await write({ id: 'nord' })).status).toBe(200);
    const response = await write({ id: 'nope' });
    expect(response.status).toBe(400);
    expect(await readBody(response)).toEqual({ error: 'bad_request' });
    expect(await readBody(await read())).toEqual({ id: 'nord' });
  });
});
