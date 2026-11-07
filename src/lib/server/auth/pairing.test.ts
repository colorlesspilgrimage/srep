import { afterEach, describe, expect, it } from 'vitest';
import {
  API_TOKEN_TOUCH_MS,
  MAX_API_TOKENS,
  PAIRING_CODE_TTL_MS,
} from '#lib/server/auth/pairing-policy.js';
import {
  createPairingCode,
  exchangePairingCode,
  formatPairingCode,
  hashPairingCode,
  normalizePairingCode,
} from '#lib/server/auth/pairing.js';
import { resolveApiToken } from '#lib/server/auth/api-tokens.js';
import { createHarness, type Harness } from '#lib/server/auth/test-support/harness.js';
import { sha256Hex } from '#lib/server/auth/tokens.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.handle.close();
  h = undefined;
});

describe('pairing codes', () => {
  it('normalizes and hashes codes', () => {
    expect(normalizePairingCode('abcd-efgh')).toBe('ABCDEFGH');
    expect(normalizePairingCode('AB0O-1ILZ')).toBe('AB00111Z');
    expect(normalizePairingCode('short')).toBeNull();
    const hash = hashPairingCode('ABCD-EFGH');
    expect(hash).toBe(sha256Hex('ABCDEFGH'));
    expect(formatPairingCode('ABCDEFGH')).toBe('ABCD-EFGH');
  });

  it('mints a code the app can exchange for a bearer token', async () => {
    h = await createHarness();
    const created = await createPairingCode(h.deps, { name: 'iPhone' });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    expect(created.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(created.qrPayload).toEqual({
      v: 1,
      origin: h.deps.auth.origin,
      code: created.code,
    });
    expect(created.expiresAt).toBe(h.clock.now + PAIRING_CODE_TTL_MS);

    const exchanged = await exchangePairingCode(h.deps, { code: created.code });
    expect(exchanged.ok).toBe(true);
    if (!exchanged.ok) {
      return;
    }
    expect(exchanged.token.startsWith('srep_')).toBe(true);
    expect(exchanged.name).toBe('iPhone');

    const row = await resolveApiToken(h.deps, exchanged.token);
    expect(row?.id).toBe(exchanged.tokenId);
    expect(row?.name).toBe('iPhone');

    // Single-use: a second claim fails.
    const again = await exchangePairingCode(h.deps, { code: created.code });
    expect(again).toEqual({ ok: false, status: 401, error: 'pairing_failed' });
  });

  it('rejects expired codes and invalidates prior open codes', async () => {
    h = await createHarness();
    const first = await createPairingCode(h.deps, { name: 'One' });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    const second = await createPairingCode(h.deps, { name: 'Two' });
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    expect(await exchangePairingCode(h.deps, { code: first.code })).toEqual({
      ok: false,
      status: 401,
      error: 'pairing_failed',
    });

    h.clock.now += PAIRING_CODE_TTL_MS + 1;
    expect(await exchangePairingCode(h.deps, { code: second.code })).toEqual({
      ok: false,
      status: 401,
      error: 'pairing_failed',
    });
  });

  it('enforces the active token cap', async () => {
    h = await createHarness();
    for (let i = 0; i < MAX_API_TOKENS; i += 1) {
      const created = await createPairingCode(h.deps, { name: `D${i}` });
      expect(created.ok).toBe(true);
      if (!created.ok) {
        return;
      }
      const exchanged = await exchangePairingCode(h.deps, { code: created.code });
      expect(exchanged.ok).toBe(true);
    }
    const extra = await createPairingCode(h.deps, { name: 'overflow' });
    expect(extra.ok).toBe(true);
    if (!extra.ok) {
      return;
    }
    expect(await exchangePairingCode(h.deps, { code: extra.code })).toEqual({
      ok: false,
      status: 409,
      error: 'token_limit',
    });
  });

  it('touches lastUsedAt on bearer resolve', async () => {
    h = await createHarness();
    const created = await createPairingCode(h.deps, { name: 'Watch' });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    const exchanged = await exchangePairingCode(h.deps, { code: created.code });
    expect(exchanged.ok).toBe(true);
    if (!exchanged.ok) {
      return;
    }
    const first = await resolveApiToken(h.deps, exchanged.token);
    expect(first?.lastUsedAt).toBe(h.clock.now);
    h.clock.now += API_TOKEN_TOUCH_MS;
    const second = await resolveApiToken(h.deps, exchanged.token);
    expect(second?.lastUsedAt).toBe(h.clock.now);
  });
});
