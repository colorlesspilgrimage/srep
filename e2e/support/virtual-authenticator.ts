import type { CDPSession, Page } from '@playwright/test';

// The CDP virtual authenticator exists only in Chromium.
export type AuthenticatorKind = 'platform' | 'usb';

export async function enableWebAuthn(page: Page): Promise<CDPSession> {
  const client = await page.context().newCDPSession(page);
  await client.send('WebAuthn.enable');
  return client;
}

const OPTIONS = {
  platform: {
    protocol: 'ctap2',
    transport: 'internal',
    hasResidentKey: true,
    hasUserVerification: true,
    isUserVerified: true,
    automaticPresenceSimulation: true,
  },
  usb: {
    protocol: 'ctap2',
    transport: 'usb',
    hasResidentKey: false,
    hasUserVerification: false,
    isUserVerified: false,
    automaticPresenceSimulation: true,
  },
} as const;

export async function addAuthenticator(
  client: CDPSession,
  kind: AuthenticatorKind,
): Promise<string> {
  const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', {
    options: OPTIONS[kind],
  });
  return authenticatorId;
}

export async function removeAuthenticator(client: CDPSession, id: string): Promise<void> {
  await client.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: id });
}

export async function getCredentials(client: CDPSession, id: string) {
  const { credentials } = await client.send('WebAuthn.getCredentials', { authenticatorId: id });
  return credentials;
}
