import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/auth/context.js', async () => {
  const { routeState } = await import('#lib/server/auth/test-support/route-support.js');
  return { getAuthContext: () => routeState.ctx };
});
import { ensureSetupToken } from '#lib/server/auth/setup.js';
import {
  makeEvent,
  readBody,
  useRouteContext,
} from '#lib/server/auth/test-support/route-support.js';
import type { Harness } from '#lib/server/auth/test-support/harness.js';
import { POST as optionsPost } from './options/+server';
import { POST as verifyPost } from './verify/+server';

let h: Harness;
afterEach(async () => {
  await h.handle.close();
});

const fields = { kind: 'passkey', nickname: 'Laptop' };

async function open() {
  const token = (await ensureSetupToken(h.deps)) ?? '';
  return token;
}

describe('POST /api/auth/setup/options', () => {
  it('returns options and a challenge id', async () => {
    ({ h } = await useRouteContext());
    const token = await open();
    const { event } = makeEvent('/api/auth/setup/options', {
      body: { setupToken: token, ...fields },
    });
    const response = await optionsPost(event);
    expect(response.status).toBe(200);
    const body = await readBody<{ challengeId: string; options: { challenge: string } }>(response);
    expect(body.challengeId.length).toBeGreaterThan(10);
    expect(body.options.challenge).toBeTruthy();
  });

  it('returns 400 for malformed JSON', async () => {
    ({ h } = await useRouteContext());
    const { event } = makeEvent('/api/auth/setup/options', {
      rawBody: '{not json',
      headers: { 'content-type': 'application/json' },
    });
    const response = await optionsPost(event);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'bad_request' });
  });

  it('returns 400 for an unknown extra key and a wrong type', async () => {
    ({ h } = await useRouteContext());
    for (const body of [
      { setupToken: 'x', ...fields, extra: 1 },
      { setupToken: 5, ...fields },
      { setupToken: 'x', kind: 'other', nickname: 'n' },
    ]) {
      const { event } = makeEvent('/api/auth/setup/options', { body });
      expect((await optionsPost(event)).status).toBe(400);
    }
  });

  it('returns 415 for a wrong content type', async () => {
    ({ h } = await useRouteContext());
    const { event } = makeEvent('/api/auth/setup/options', {
      rawBody: 'a=b',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    const response = await optionsPost(event);
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ error: 'unsupported_media_type' });
  });

  it('returns 413 for a body over 64 KiB, with or without a length header', async () => {
    ({ h } = await useRouteContext());
    const big = JSON.stringify({ setupToken: 'a'.repeat(70 * 1024), ...fields });
    const withHeader = makeEvent('/api/auth/setup/options', {
      rawBody: big,
      headers: { 'content-type': 'application/json', 'content-length': String(big.length) },
    });
    expect((await optionsPost(withHeader.event)).status).toBe(413);
    const request = new Request('http://localhost:3000/api/auth/setup/options', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(big));
          controller.close();
        },
      }),
      duplex: 'half',
    } as RequestInit);
    const streamed = makeEvent('/api/auth/setup/options');
    const event = { ...(streamed.event as object), request } as never;
    expect((await optionsPost(event)).status).toBe(413);
  });

  it('counts bad tokens globally and then returns 429 with Retry-After', async () => {
    ({ h } = await useRouteContext());
    await open();
    for (let i = 0; i < 5; i += 1) {
      const { event } = makeEvent('/api/auth/setup/options', {
        body: { setupToken: 'bad', ...fields },
        address: `198.51.100.${i}`,
      });
      expect((await optionsPost(event)).status).toBe(403);
    }
    const { event } = makeEvent('/api/auth/setup/options', {
      body: { setupToken: 'bad', ...fields },
      address: '198.51.100.99',
    });
    const response = await optionsPost(event);
    expect(response.status).toBe(429);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await response.json()).toEqual({ error: 'rate_limited' });
  });

  // Regression: a parallel burst of bad tokens must stop at the global failure limit.
  it('stops a parallel burst of bad tokens at the failure limit', async () => {
    ({ h } = await useRouteContext());
    await open();
    const burst = Array.from({ length: 8 }, (_, i) =>
      optionsPost(
        makeEvent('/api/auth/setup/options', {
          body: { setupToken: 'bad', ...fields },
          address: `203.0.113.${i}`,
        }).event,
      ),
    );
    const statuses = (await Promise.all(burst)).map((r) => r.status).sort();
    expect(statuses).toEqual([403, 403, 403, 403, 403, 429, 429, 429]);
  });

  it('limits attempts per client address', async () => {
    ({ h } = await useRouteContext());
    let last = 0;
    for (let i = 0; i < 21; i += 1) {
      const { event } = makeEvent('/api/auth/setup/options', {
        rawBody: '{}',
        headers: { 'content-type': 'application/json' },
      });
      last = (await optionsPost(event)).status;
    }
    expect(last).toBe(429);
  });

  // Parallel requests must not pass the global limit before one failure is counted (CWE-307).
  it('lets at most 5 parallel bad tokens reach the token check', async () => {
    ({ h } = await useRouteContext());
    await open();
    const requests = Array.from({ length: 12 }, (_, i) =>
      optionsPost(
        makeEvent('/api/auth/setup/options', {
          body: { setupToken: 'bad', ...fields },
          address: `198.51.100.${i}`,
        }).event,
      ),
    );
    const statuses = (await Promise.all(requests)).map((r) => r.status);
    expect(statuses.filter((s) => s === 403)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(7);
  });

  it('does not count a good token or a malformed body as a failure', async () => {
    ({ h } = await useRouteContext());
    const token = await open();
    for (let i = 0; i < 6; i += 1) {
      const malformed = makeEvent('/api/auth/setup/options', {
        rawBody: '{',
        headers: { 'content-type': 'application/json' },
        address: `198.51.100.${i}`,
      });
      expect((await optionsPost(malformed.event)).status).toBe(400);
      const good = makeEvent('/api/auth/setup/options', {
        body: { setupToken: token, ...fields },
        address: `198.51.100.${20 + i}`,
      });
      expect((await optionsPost(good.event)).status).toBe(200);
    }
  });
});

describe('POST /api/auth/setup/verify', () => {
  it('sets the session cookie and returns the recovery codes once', async () => {
    ({ h } = await useRouteContext());
    const token = await open();
    const first = makeEvent('/api/auth/setup/options', { body: { setupToken: token, ...fields } });
    const { challengeId } = await readBody<{ challengeId: string }>(await optionsPost(first.event));
    const { event, cookiesSet } = makeEvent('/api/auth/setup/verify', {
      body: { setupToken: token, challengeId, response: { id: 'cred-default' }, ...fields },
    });
    const response = await verifyPost(event);
    expect(response.status).toBe(200);
    const body = await readBody<{
      recoveryCodes: string[];
      credential: Record<string, unknown>;
      csrfToken: string;
    }>(response);
    expect(body.recoveryCodes).toHaveLength(10);
    expect(body.csrfToken.length).toBeGreaterThan(20);
    expect(body.credential).not.toHaveProperty('publicKey');
    expect(cookiesSet).toHaveLength(1);
    expect(cookiesSet[0]).toMatchObject({
      name: 'srep_session',
      options: { httpOnly: true, sameSite: 'strict', path: '/', secure: false },
    });
    expect(cookiesSet[0]?.options).not.toHaveProperty('domain');
  });

  it('returns only the stable error code on failure', async () => {
    ({ h } = await useRouteContext());
    const token = await open();
    const first = makeEvent('/api/auth/setup/options', { body: { setupToken: token, ...fields } });
    const { challengeId } = await readBody<{ challengeId: string }>(await optionsPost(first.event));
    h.webauthn.registration = 'fail';
    const { event } = makeEvent('/api/auth/setup/verify', {
      body: { setupToken: token, challengeId, response: { id: 'x' }, ...fields },
    });
    const response = await verifyPost(event);
    expect(response.status).toBe(400);
    expect(await response.text()).toBe('{"error":"verification_failed"}');
  });

  it('returns 403 setup_locked after setup', async () => {
    ({ h } = await useRouteContext());
    const token = await open();
    const first = makeEvent('/api/auth/setup/options', { body: { setupToken: token, ...fields } });
    const { challengeId } = await readBody<{ challengeId: string }>(await optionsPost(first.event));
    const body = { setupToken: token, challengeId, response: { id: 'cred-default' }, ...fields };
    await verifyPost(makeEvent('/api/auth/setup/verify', { body }).event);
    const again = await verifyPost(makeEvent('/api/auth/setup/verify', { body }).event);
    expect(again.status).toBe(403);
    expect(await again.json()).toEqual({ error: 'setup_locked' });
  });

  it('returns 400 for a malformed body', async () => {
    ({ h } = await useRouteContext());
    const { event } = makeEvent('/api/auth/setup/verify', { body: { setupToken: 'x' } });
    expect((await verifyPost(event)).status).toBe(400);
  });

  // Regression: a parallel burst of bad tokens must stop at the global failure limit.
  it('counts bad tokens in a parallel burst and then blocks', async () => {
    ({ h } = await useRouteContext());
    await open();
    const body = { setupToken: 'bad', challengeId: 'c', response: { id: 'x' }, ...fields };
    const send = (i: number) =>
      verifyPost(makeEvent('/api/auth/setup/verify', { body, address: `203.0.113.${i}` }).event);
    const statuses = (await Promise.all([0, 1, 2, 3, 4, 5].map(send))).map((r) => r.status);
    expect(statuses.sort()).toEqual([403, 403, 403, 403, 403, 429]);
    const after = await send(9);
    expect(after.status).toBe(429);
    expect(Number(after.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});
