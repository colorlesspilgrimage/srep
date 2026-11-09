import { expect, type Page } from '@playwright/test';
import { addAuthenticator, enableWebAuthn } from './virtual-authenticator';

/**
 * Sign in through the WebAuthn API ceremony.
 *
 * The v2 /setup UI renders its inputs disabled, so the v1-era UI sign-in
 * (fill Setup token in the page) can never work. This posts to the same
 * setup endpoints the UI would use and completes the passkey ceremony
 * with a virtual authenticator, which sets the session cookie.
 */
export async function signInViaApi(
  page: Page,
  setupToken: string,
  nickname: string,
): Promise<void> {
  const cdp = await enableWebAuthn(page);
  await addAuthenticator(cdp, 'platform');

  await page.goto('/');

  const authHeaders = {
    origin: 'http://localhost:4173',
    'content-type': 'application/json',
  };
  const optionsResponse = await page.request.post('/api/auth/setup/options', {
    headers: authHeaders,
    data: { setupToken, nickname, kind: 'passkey' },
  });
  expect(optionsResponse.status()).toBe(200);
  const { options, challengeId } = await optionsResponse.json();

  const response = await page.evaluate(async (options) => {
    const fromBase64url = (value: string): ArrayBuffer => {
      const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64.padEnd(
        base64.length + ((4 - (base64.length % 4)) % 4),
        '=',
      );
      const binary = atob(padded);
      return Uint8Array.from(binary, (char) => char.charCodeAt(0)).buffer;
    };
    const toBase64url = (value: ArrayBuffer): string => {
      let binary = '';
      for (const byte of new Uint8Array(value)) {
        binary += String.fromCharCode(byte);
      }
      return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    };

    const publicKey: PublicKeyCredentialCreationOptions = {
      ...(options.publicKey ?? options),
      challenge: fromBase64url((options.publicKey ?? options).challenge),
      user: {
        ...(options.publicKey ?? options).user,
        id: fromBase64url((options.publicKey ?? options).user.id),
      },
      excludeCredentials: ((options.publicKey ?? options).excludeCredentials ?? []).map(
        (credential: { id: string }) => ({
          ...credential,
          id: fromBase64url(credential.id),
        }),
      ),
    };
    const credential = (await navigator.credentials.create({
      publicKey,
    })) as PublicKeyCredential;
    const attestation = credential.response as AuthenticatorAttestationResponse;

    return {
      id: credential.id,
      rawId: toBase64url(credential.rawId),
      type: credential.type,
      response: {
        attestationObject: toBase64url(attestation.attestationObject),
        clientDataJSON: toBase64url(attestation.clientDataJSON),
      },
      authenticatorAttachment: credential.authenticatorAttachment,
      clientExtensionResults: credential.getClientExtensionResults(),
    };
  }, options);

  const verifyResponse = await page.request.post('/api/auth/setup/verify', {
    headers: authHeaders,
    data: {
      setupToken,
      challengeId,
      response,
      kind: 'passkey',
      nickname,
    },
  });
  expect(verifyResponse.status()).toBe(200);
}
