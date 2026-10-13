import { afterEach, describe, expect, it, vi } from 'vitest';
import { appSettings } from '#lib/server/db/schema/sqlite.js';
import { THEME_SETTINGS_KEY } from '#lib/server/settings/theme-key.js';

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

function expectPrivateCache(response: Response): void {
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('vary')).toBe('Cookie');
}

describe('/api/settings/theme', () => {
  it('returns phosphor-green when the row is absent', async () => {
    await openRoute();
    const response = await read();
    expectPrivateCache(response);
    expect(await readBody(response)).toEqual({ id: 'phosphor-green' });
  });

  it('stores nord and the next GET returns the same object', async () => {
    await openRoute();
    const response = await write({ id: 'nord' });
    expect(response.status).toBe(200);
    expectPrivateCache(response);
    expect(await readBody(response)).toEqual({ id: 'nord' });
    const next = await read();
    expectPrivateCache(next);
    expect(await readBody(next)).toEqual({ id: 'nord' });
  });

  it('refuses a bad body with 400', async () => {
    await openRoute();
    for (const body of [
      { id: 'nope' },
      { id: 'nord', extra: true },
      {},
      { id: 1 },
      { id: 'nord', key: 'study' },
      { id: 'nord', key: 'auth.setup_complete' },
      { id: '<script>alert(1)</script>' },
      { id: "nord'; DROP TABLE app_settings;--" },
      { id: 'nord\u0000' },
      { id: ['nord'] },
      ['nord'],
      null,
    ]) {
      const response = await write(body);
      expect(response.status).toBe(400);
      expectPrivateCache(response);
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
    expectPrivateCache(response);
  });

  it('keeps the last good id after a bad PUT', async () => {
    await openRoute();
    expect((await write({ id: 'nord' })).status).toBe(200);
    const response = await write({ id: 'nope' });
    expect(response.status).toBe(400);
    expectPrivateCache(response);
    expect(await readBody(response)).toEqual({ error: 'bad_request' });
    expect(await readBody(await read())).toEqual({ id: 'nord' });
  });

  it('does not store a text body', async () => {
    await openRoute();
    expect((await write({ id: 'nord' })).status).toBe(200);
    const { event } = makeEvent('/api/settings/theme', {
      method: 'PUT',
      rawBody: '{"id":"amber-crt"}',
      headers: { 'content-type': 'text/plain' },
      session,
    });
    const response = await PUT(event);
    expect(response.status).toBe(415);
    expectPrivateCache(response);
    expect(await readBody(response)).toEqual({ error: 'unsupported_media_type' });
    expect(await readBody(await read())).toEqual({ id: 'nord' });
  });

  it('does not return a stored script id', async () => {
    await openRoute();
    if (h.handle.dialect !== 'sqlite') {
      throw new Error('expected sqlite');
    }
    h.handle.db
      .insert(appSettings)
      .values({ key: THEME_SETTINGS_KEY, value: { id: '<script>alert(1)</script>' } })
      .run();
    const response = await read();
    expect(response.status).toBe(500);
    expectPrivateCache(response);
    const body = await readBody(response);
    expect(body).toEqual({ error: 'settings_corrupt' });
    expect(JSON.stringify(body)).not.toContain('<script>');
  });
});
