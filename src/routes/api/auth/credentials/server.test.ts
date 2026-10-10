import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/auth/context.js', async () => {
  const { routeState } = await import('#lib/server/auth/test-support/route-support.js');
  return { getAuthContext: () => routeState.ctx };
});
import { listCredentials } from '#lib/server/auth/credentials.js';
import { doSetup, type Harness } from '#lib/server/auth/test-support/harness.js';
import {
  makeEvent,
  readBody,
  useRouteContext,
} from '#lib/server/auth/test-support/route-support.js';
import { GET } from './+server';
import { DELETE, PATCH } from './[id]/+server';
import { POST as optionsPost } from './options/+server';
import { POST as verifyPost } from './verify/+server';

let h: Harness;
afterEach(async () => {
  await h.handle.close();
});

const session = { id: 's', csrfToken: 't' };

describe('credentials routes', () => {
  it('lists credentials without key material', async () => {
    ({ h } = await useRouteContext());
    await doSetup(h);
    const { event } = makeEvent('/api/auth/credentials', { method: 'GET', session });
    const text = await (await GET(event)).text();
    expect(text).toContain('"nickname":"Laptop"');
    expect(text).not.toContain('publicKey');
    expect(text).not.toContain('cred-default');
  });

  it('adds a security key with options then verify', async () => {
    ({ h } = await useRouteContext());
    await doSetup(h);
    const body = { kind: 'security_key', nickname: 'Key' };
    const first = makeEvent('/api/auth/credentials/options', { body, session });
    const { challengeId } = await readBody<{ challengeId: string }>(await optionsPost(first.event));
    h.webauthn.registration = {
      credentialId: 'key-1',
      publicKey: 'pk',
      signCount: 0,
      transports: ['usb'],
    };
    const second = makeEvent('/api/auth/credentials/verify', {
      body: { ...body, challengeId, response: { id: 'key-1' } },
      session,
    });
    const response = await verifyPost(second.event);
    expect(response.status).toBe(200);
    expect(await listCredentials(h.deps)).toHaveLength(2);
  });

  it('returns 409 for a duplicate credential', async () => {
    ({ h } = await useRouteContext());
    await doSetup(h);
    const body = { kind: 'passkey', nickname: 'Again' };
    const first = makeEvent('/api/auth/credentials/options', { body, session });
    const { challengeId } = await readBody<{ challengeId: string }>(await optionsPost(first.event));
    const second = makeEvent('/api/auth/credentials/verify', {
      body: { ...body, challengeId, response: { id: 'cred-default' } },
      session,
    });
    const response = await verifyPost(second.event);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'duplicate_credential' });
  });

  it('renames and revokes, and refuses the last credential', async () => {
    ({ h } = await useRouteContext());
    await doSetup(h);
    const [only] = await listCredentials(h.deps);
    const id = only?.id ?? '';
    const rename = makeEvent('/api/auth/credentials/' + id, {
      method: 'PATCH',
      body: { nickname: 'Renamed' },
      params: { id },
      session,
    });
    expect((await PATCH(rename.event)).status).toBe(200);
    expect((await listCredentials(h.deps))[0]?.nickname).toBe('Renamed');
    const revoke = makeEvent('/api/auth/credentials/' + id, {
      method: 'DELETE',
      params: { id },
      session,
    });
    const response = await DELETE(revoke.event);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'last_credential' });
  });

  it('returns 400 for an id that is not a UUID and 404 for an unknown UUID', async () => {
    ({ h } = await useRouteContext());
    await doSetup(h);
    const bad = makeEvent('/api/auth/credentials/x', {
      method: 'DELETE',
      params: { id: '../etc' },
      session,
    });
    expect((await DELETE(bad.event)).status).toBe(400);
    const badPatch = makeEvent('/api/auth/credentials/x', {
      method: 'PATCH',
      body: { nickname: 'n' },
      params: { id: 'x' },
      session,
    });
    expect((await PATCH(badPatch.event)).status).toBe(400);
    const unknown = makeEvent('/api/auth/credentials/x', {
      method: 'DELETE',
      params: { id: '123e4567-e89b-42d3-a456-426614174000' },
      session,
    });
    expect((await DELETE(unknown.event)).status).toBe(404);
    const unknownPatch = makeEvent('/api/auth/credentials/x', {
      method: 'PATCH',
      body: { nickname: 'n' },
      params: { id: '123e4567-e89b-42d3-a456-426614174000' },
      session,
    });
    expect((await PATCH(unknownPatch.event)).status).toBe(404);
  });

  it('returns 400 for a bad rename body and a bad options body', async () => {
    ({ h } = await useRouteContext());
    await doSetup(h);
    const id = '123e4567-e89b-42d3-a456-426614174000';
    const rename = makeEvent('/api/auth/credentials/x', {
      method: 'PATCH',
      body: { nickname: 'n', extra: 1 },
      params: { id },
      session,
    });
    expect((await PATCH(rename.event)).status).toBe(400);
    const options = makeEvent('/api/auth/credentials/options', { body: { kind: 'x' }, session });
    expect((await optionsPost(options.event)).status).toBe(400);
    const verify = makeEvent('/api/auth/credentials/verify', { body: {}, session });
    expect((await verifyPost(verify.event)).status).toBe(400);
  });

  it('returns 400 for an invalid nickname from the service', async () => {
    ({ h } = await useRouteContext());
    await doSetup(h);
    const options = makeEvent('/api/auth/credentials/options', {
      body: { kind: 'passkey', nickname: '   ' },
      session,
    });
    const response = await optionsPost(options.event);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_nickname' });
  });

  it('returns 429 when the address limit is used up', async () => {
    ({ h } = await useRouteContext());
    let last = 0;
    for (let i = 0; i < 21; i += 1) {
      const { event } = makeEvent('/api/auth/credentials/options', { body: {}, session });
      last = (await optionsPost(event)).status;
    }
    expect(last).toBe(429);
    const { event } = makeEvent('/api/auth/credentials/verify', { body: {}, session });
    expect((await verifyPost(event)).status).toBe(429);
  });
});
