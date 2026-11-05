import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DISPLAY } from '#lib/client/app/display-prefs.js';
import { appSettings } from '#lib/server/db/schema/sqlite.js';
import { DISPLAY_SETTINGS_KEY } from '#lib/server/settings/display-key.js';

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

// Contract: GET and PUT /api/settings/display. A bad body does not replace a good value.

let h: DomainHarness;

afterEach(async () => {
  await h.close();
});

async function openRoute(): Promise<void> {
  h = await createDomainHarness();
  routeState.handle = h.handle;
}

const read = () => GET(makeEvent('/api/settings/display', { method: 'GET', session }).event);

const write = (body: unknown) =>
  PUT(makeEvent('/api/settings/display', { method: 'PUT', body, session }).event);

function expectPrivateCache(response: Response): void {
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('vary')).toBe('Cookie');
}

const SAVED = {
  fontSize: 18,
  reducedMotion: true,
  scanline: true,
  cursorBlink: false,
};

describe('/api/settings/display', () => {
  it('returns defaults when the row is absent', async () => {
    await openRoute();
    const response = await read();
    expectPrivateCache(response);
    expect(await readBody(response)).toEqual({ display: DEFAULT_DISPLAY });
  });

  it('stores prefs and the next GET returns the same object', async () => {
    await openRoute();
    const response = await write(SAVED);
    expect(response.status).toBe(200);
    expectPrivateCache(response);
    expect(await readBody(response)).toEqual({ display: SAVED });
    const next = await read();
    expectPrivateCache(next);
    expect(await readBody(next)).toEqual({ display: SAVED });
  });

  it('refuses a bad body with 400', async () => {
    await openRoute();
    for (const body of [
      { fontSize: 99, reducedMotion: false, scanline: false, cursorBlink: false },
      { ...SAVED, extra: true },
      {},
      { fontSize: 16 },
      { fontSize: '18', reducedMotion: true, scanline: true, cursorBlink: false },
      null,
      ['display'],
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
    const { event } = makeEvent('/api/settings/display', {
      method: 'PUT',
      rawBody,
      headers: { 'content-type': 'application/json' },
      session,
    });
    const response = await PUT(event);
    expect(response.status).toBe(413);
    expectPrivateCache(response);
  });

  it('keeps the last good value after a bad PUT', async () => {
    await openRoute();
    expect((await write(SAVED)).status).toBe(200);
    const response = await write({
      fontSize: 99,
      reducedMotion: false,
      scanline: false,
      cursorBlink: false,
    });
    expect(response.status).toBe(400);
    expectPrivateCache(response);
    expect(await readBody(response)).toEqual({ error: 'bad_request' });
    expect(await readBody(await read())).toEqual({ display: SAVED });
  });

  it('does not store a text body', async () => {
    await openRoute();
    expect((await write(SAVED)).status).toBe(200);
    const { event } = makeEvent('/api/settings/display', {
      method: 'PUT',
      rawBody: JSON.stringify(DEFAULT_DISPLAY),
      headers: { 'content-type': 'text/plain' },
      session,
    });
    const response = await PUT(event);
    expect(response.status).toBe(415);
    expectPrivateCache(response);
    expect(await readBody(response)).toEqual({ error: 'unsupported_media_type' });
    expect(await readBody(await read())).toEqual({ display: SAVED });
  });

  it('does not return a corrupt stored value', async () => {
    await openRoute();
    if (h.handle.dialect !== 'sqlite') {
      throw new Error('expected sqlite');
    }
    h.handle.db
      .insert(appSettings)
      .values({
        key: DISPLAY_SETTINGS_KEY,
        value: { fontSize: 99, reducedMotion: false, scanline: false, cursorBlink: false },
      })
      .run();
    const response = await read();
    expect(response.status).toBe(500);
    expectPrivateCache(response);
    expect(await readBody(response)).toEqual({ error: 'settings_corrupt' });
  });
});
