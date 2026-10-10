import { describe, expect, it } from 'vitest';
import type { AuthConfig } from '#lib/server/auth/rp-config.js';
import {
  makeAssertion,
  makeRegistration,
} from '#lib/server/auth/test-support/software-authenticator.js';
import {
  WebAuthnError,
  checkSignCount,
  sanitizeTransports,
  webAuthn,
} from '#lib/server/auth/webauthn.js';

const auth: AuthConfig = {
  origin: 'https://srep.example.com',
  rpId: 'srep.example.com',
  rpName: 'srep',
  secureCookies: true,
};
const userId = Buffer.alloc(32, 9).toString('base64url');
const CHALLENGE = 'Y2hhbGxlbmdlLTE';

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error: unknown) {
    return error instanceof WebAuthnError ? error.code : 'other';
  }
  return 'none';
}

async function enrolled(signCount = 0) {
  const made = makeRegistration({
    rpId: auth.rpId,
    origin: auth.origin,
    challenge: CHALLENGE,
    signCount,
  });
  const verified = await webAuthn.verifyRegistration({
    auth,
    expectedChallenge: CHALLENGE,
    response: made.response,
  });
  return { made, verified };
}

describe('registration options', () => {
  it('asks a passkey for a resident platform credential', async () => {
    const options = await webAuthn.registrationOptions({
      auth,
      userId,
      kind: 'passkey',
      existing: [{ credentialId: 'abc', transports: ['usb'] }],
    });
    expect(options.rp).toEqual({ id: 'srep.example.com', name: 'srep' });
    expect(options.attestation).toBe('none');
    expect(options.authenticatorSelection).toMatchObject({
      authenticatorAttachment: 'platform',
      residentKey: 'required',
      userVerification: 'preferred',
    });
    expect(options.excludeCredentials?.[0]?.id).toBe('abc');
    expect(options.user.id).toBe(userId);
  });

  it('asks a security key for a cross-platform authenticator', async () => {
    const options = await webAuthn.registrationOptions({
      auth,
      userId,
      kind: 'security_key',
      existing: [],
    });
    expect(options.authenticatorSelection).toMatchObject({
      authenticatorAttachment: 'cross-platform',
      residentKey: 'preferred',
      userVerification: 'preferred',
    });
  });
});

describe('verifyRegistration', () => {
  it('accepts a valid registration', async () => {
    const { made, verified } = await enrolled(3);
    expect(verified.credentialId).toBe(made.credentialId);
    expect(verified.signCount).toBe(3);
    expect(verified.transports).toEqual(['internal']);
    expect(verified.publicKey.length).toBeGreaterThan(20);
  });

  it('rejects a wrong origin', async () => {
    const made = makeRegistration({
      rpId: auth.rpId,
      origin: 'https://evil.example',
      challenge: CHALLENGE,
    });
    expect(
      await codeOf(
        webAuthn.verifyRegistration({
          auth,
          expectedChallenge: CHALLENGE,
          response: made.response,
        }),
      ),
    ).toBe('verification_failed');
  });

  it('rejects a wrong RP ID', async () => {
    const made = makeRegistration({
      rpId: 'evil.example',
      origin: auth.origin,
      challenge: CHALLENGE,
    });
    expect(
      await codeOf(
        webAuthn.verifyRegistration({
          auth,
          expectedChallenge: CHALLENGE,
          response: made.response,
        }),
      ),
    ).toBe('verification_failed');
  });

  it('rejects a wrong challenge', async () => {
    const made = makeRegistration({ rpId: auth.rpId, origin: auth.origin, challenge: 'other' });
    expect(
      await codeOf(
        webAuthn.verifyRegistration({
          auth,
          expectedChallenge: CHALLENGE,
          response: made.response,
        }),
      ),
    ).toBe('verification_failed');
  });
});

describe('verifyAuthentication', () => {
  async function login(stored: number, reported: number, overrides: { origin?: string } = {}) {
    const { made, verified } = await enrolled(stored);
    const response = makeAssertion({
      rpId: auth.rpId,
      origin: overrides.origin ?? auth.origin,
      challenge: CHALLENGE,
      credentialId: made.credentialId,
      privateKey: made.keys.privateKey,
      counter: reported,
    });
    return webAuthn.verifyAuthentication({
      auth,
      expectedChallenge: CHALLENGE,
      response,
      credential: { ...verified, signCount: stored },
    });
  }

  it.each([
    [0, 0],
    [5, 6],
    [0, 1],
  ])('accepts counter %i to %i', async (stored, reported) => {
    expect(await login(stored, reported)).toEqual({ newSignCount: reported });
  });

  it.each([
    [5, 5],
    [5, 4],
  ])('rejects counter %i to %i as a replay', async (stored, reported) => {
    expect(await codeOf(login(stored, reported))).toBe('counter_replay');
  });

  it('rejects a wrong origin', async () => {
    expect(await codeOf(login(0, 1, { origin: 'https://evil.example' }))).toBe(
      'verification_failed',
    );
  });

  it('rejects a signature from another key', async () => {
    const { made, verified } = await enrolled();
    const other = makeRegistration({ rpId: auth.rpId, origin: auth.origin, challenge: CHALLENGE });
    const response = makeAssertion({
      rpId: auth.rpId,
      origin: auth.origin,
      challenge: CHALLENGE,
      credentialId: made.credentialId,
      privateKey: other.keys.privateKey,
      counter: 1,
    });
    expect(
      await codeOf(
        webAuthn.verifyAuthentication({
          auth,
          expectedChallenge: CHALLENGE,
          response,
          credential: verified,
        }),
      ),
    ).toBe('verification_failed');
  });

  it('builds authentication options for passkey and security key login', async () => {
    const open = await webAuthn.authenticationOptions({ auth });
    expect(open.allowCredentials ?? []).toEqual([]);
    expect(open.rpId).toBe(auth.rpId);
    expect(open.userVerification).toBe('preferred');
    const listed = await webAuthn.authenticationOptions({
      auth,
      allow: [{ credentialId: 'k1', transports: ['usb'] }],
    });
    expect(listed.allowCredentials?.map((c) => c.id)).toEqual(['k1']);
  });
});

describe('helpers', () => {
  it.each([
    [0, 0, true],
    [0, 1, true],
    [5, 6, true],
    [5, 5, false],
    [5, 4, false],
    [5, 0, false],
    [1, 0, false],
  ])('checkSignCount(%i, %i) is %s', (stored, reported, expected) => {
    expect(checkSignCount(stored, reported)).toBe(expected);
  });

  it('keeps only known transports', () => {
    expect(sanitizeTransports(['usb', 'evil', 'hybrid', 'smart-card'])).toEqual([
      'usb',
      'hybrid',
      'smart-card',
    ]);
    expect(sanitizeTransports(undefined)).toEqual([]);
  });

  // Regression: a client can send one value many times. Store each value once.
  it('stores each transport once', () => {
    expect(sanitizeTransports(Array.from({ length: 5000 }, () => 'usb'))).toEqual(['usb']);
    expect(sanitizeTransports(['nfc', 'usb', 'nfc'])).toEqual(['nfc', 'usb']);
  });
});
