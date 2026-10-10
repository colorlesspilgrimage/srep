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
import { POST as optionsPost } from './options/+server';
import { POST as verifyPost } from './verify/+server';
import { POST as recoveryPost } from '../recovery/login/+server';

let h: Harness;
afterEach(async () => {
  await h.handle.close();
});

async function challenge(): Promise<string> {
  const { event } = makeEvent('/api/auth/login/options', { body: { kind: 'passkey' } });
  const body = await readBody<{ challengeId: string }>(await optionsPost(event));
  return body.challengeId;
}

describe('POST /api/auth/login/options', () => {
  it('returns 403 setup_required before setup', async () => {
    ({ h } = await useRouteContext());
    const { event } = makeEvent('/api/auth/login/options', { body: {} });
    const response = await optionsPost(event);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'setup_required' });
  });

  it('defaults to a passkey login', async () => {
    ({ h } = await useRouteContext());
    await doSetup(h);
    const { event } = makeEvent('/api/auth/login/options', { body: {} });
    expect((await optionsPost(event)).status).toBe(200);
    expect(h.webauthn.lastAllow).toBeUndefined();
  });

  it('returns 400 no_security_key when none is enrolled', async () => {
    ({ h } = await useRouteContext());
    await doSetup(h);
    const { event } = makeEvent('/api/auth/login/options', { body: { kind: 'security_key' } });
    const response = await optionsPost(event);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'no_security_key' });
  });

  it('returns 429 with Retry-After after 20 attempts from one address', async () => {
    ({ h } = await useRouteContext());
    const statuses: number[] = [];
    let retry: string | null = null;
    for (let i = 0; i < 21; i += 1) {
      const { event } = makeEvent('/api/auth/login/options', { body: {} });
      const response = await optionsPost(event);
      statuses.push(response.status);
      retry = response.headers.get('retry-after');
    }
    expect(statuses.slice(0, 20).every((s) => s === 403)).toBe(true);
    expect(statuses[20]).toBe(429);
    expect(Number(retry)).toBeGreaterThan(0);
    const other = makeEvent('/api/auth/login/options', { body: {}, address: '192.0.2.1' });
    expect((await optionsPost(other.event)).status).toBe(403);
  });
});

describe('POST /api/auth/login/verify', () => {
  it('sets a strict cookie on success', async () => {
    ({ h } = await useRouteContext());
    await doSetup(h);
    const challengeId = await challenge();
    const { event, cookiesSet } = makeEvent('/api/auth/login/verify', {
      body: { challengeId, response: { id: 'cred-default' } },
    });
    const response = await verifyPost(event);
    expect(response.status).toBe(200);
    expect(Object.keys((await response.json()) as object)).toEqual(['csrfToken']);
    expect(cookiesSet[0]).toMatchObject({
      name: 'srep_session',
      options: { httpOnly: true, sameSite: 'strict', path: '/', secure: false },
    });
  });

  it('uses the __Host- cookie and Secure for an https origin', async () => {
    ({ h } = await useRouteContext({ SREP_ORIGIN: 'https://srep.example.com' }));
    await doSetup(h);
    const challengeId = await challenge();
    const { event, cookiesSet } = makeEvent('/api/auth/login/verify', {
      body: { challengeId, response: { id: 'cred-default' } },
    });
    await verifyPost(event);
    expect(cookiesSet[0]).toMatchObject({
      name: '__Host-srep_session',
      options: { secure: true, httpOnly: true, sameSite: 'strict', path: '/' },
    });
  });

  it('returns one stable 401 body for a failed login', async () => {
    ({ h } = await useRouteContext());
    await doSetup(h);
    const challengeId = await challenge();
    h.webauthn.authentication = 'fail';
    const { event, cookiesSet } = makeEvent('/api/auth/login/verify', {
      body: { challengeId, response: { id: 'cred-default' } },
    });
    const response = await verifyPost(event);
    expect(response.status).toBe(401);
    expect(await response.text()).toBe('{"error":"login_failed"}');
    expect(cookiesSet).toHaveLength(0);
  });

  it('returns 400 when the response has no id', async () => {
    ({ h } = await useRouteContext());
    const { event } = makeEvent('/api/auth/login/verify', {
      body: { challengeId: 'x', response: {} },
    });
    expect((await verifyPost(event)).status).toBe(400);
  });
});

describe('POST /api/auth/recovery/login', () => {
  it('logs in with a code once and counts failures globally', async () => {
    ({ h } = await useRouteContext());
    const done = await doSetup(h);
    const good = makeEvent('/api/auth/recovery/login', {
      body: { code: done.recoveryCodes[0] },
    });
    const response = await recoveryPost(good.event);
    expect(response.status).toBe(200);
    expect((await readBody<{ remaining: number }>(response)).remaining).toBe(9);
    expect(good.cookiesSet).toHaveLength(1);
    for (let i = 0; i < 5; i += 1) {
      const bad = makeEvent('/api/auth/recovery/login', {
        body: { code: '00000-00000' },
        address: `198.51.100.${i}`,
      });
      expect((await recoveryPost(bad.event)).status).toBe(401);
    }
    const blocked = makeEvent('/api/auth/recovery/login', {
      body: { code: done.recoveryCodes[1] },
      address: '198.51.100.77',
    });
    const last = await recoveryPost(blocked.event);
    expect(last.status).toBe(429);
    expect(last.headers.get('retry-after')).not.toBeNull();
  });

  it('returns 400 for an unknown key', async () => {
    ({ h } = await useRouteContext());
    const { event } = makeEvent('/api/auth/recovery/login', { body: { code: 'x', more: 1 } });
    expect((await recoveryPost(event)).status).toBe(400);
  });
});
