import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEYBINDS, PALETTE_CLOSE, PALETTE_OPEN } from '#lib/client/tui/keymap.js';
import { appSettings } from '#lib/server/db/schema/sqlite.js';
import { KEYBIND_SETTINGS_KEY } from '#lib/server/settings/keybind-key.js';

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

// Contract: GET and PUT /api/settings/keybinds. A bad body does not replace a good map.

let h: DomainHarness;

afterEach(async () => {
  await h.close();
});

async function openRoute(): Promise<void> {
  h = await createDomainHarness();
  routeState.handle = h.handle;
}

const read = () => GET(makeEvent('/api/settings/keybinds', { method: 'GET', session }).event);

const write = (body: unknown) =>
  PUT(makeEvent('/api/settings/keybinds', { method: 'PUT', body, session }).event);

function expectPrivateCache(response: Response): void {
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('vary')).toBe('Cookie');
}

describe('/api/settings/keybinds', () => {
  it('GET then PUT of the default map returns 200', async () => {
    await openRoute();
    const first = await read();
    expect(first.status).toBe(200);
    expectPrivateCache(first);
    expect(await readBody(first)).toEqual({ keybinds: DEFAULT_KEYBINDS });
    const saved = await write(DEFAULT_KEYBINDS);
    expect(saved.status).toBe(200);
    expectPrivateCache(saved);
    expect(await readBody(saved)).toEqual({ keybinds: DEFAULT_KEYBINDS });
  });

  it('a duplicate chord returns 400 and does not change GET', async () => {
    await openRoute();
    expect((await write(DEFAULT_KEYBINDS)).status).toBe(200);
    const response = await write({ ...DEFAULT_KEYBINDS, [PALETTE_CLOSE]: 'Ctrl+K' });
    expect(response.status).toBe(400);
    expectPrivateCache(response);
    expect(await readBody(response)).toEqual({ error: 'bad_request' });
    const next = await read();
    expect(next.status).toBe(200);
    expect(await readBody(next)).toEqual({ keybinds: DEFAULT_KEYBINDS });
  });

  it('returns 400 when a key is missing', async () => {
    await openRoute();
    const response = await write({ [PALETTE_OPEN]: 'Ctrl+K' });
    expect(response.status).toBe(400);
    expectPrivateCache(response);
    expect(await readBody(response)).toEqual({ error: 'bad_request' });
    expect(await readBody(await read())).toEqual({ keybinds: DEFAULT_KEYBINDS });
  });

  it('returns 500 when the stored map is corrupt', async () => {
    await openRoute();
    if (h.handle.dialect !== 'sqlite') {
      throw new Error('expected sqlite');
    }
    h.handle.db
      .insert(appSettings)
      .values({ key: KEYBIND_SETTINGS_KEY, value: { [PALETTE_OPEN]: 'nope' } })
      .run();
    const response = await read();
    expect(response.status).toBe(500);
    expectPrivateCache(response);
    const body = await readBody(response);
    expect(body).toEqual({ error: 'settings_corrupt' });
    expect(JSON.stringify(body)).not.toContain('nope');
  });
});
