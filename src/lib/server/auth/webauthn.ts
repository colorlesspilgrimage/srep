import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { AuthConfig } from '#lib/server/auth/rp-config.js';

export type CredentialKind = 'passkey' | 'security_key';
export type CredentialRef = { credentialId: string; transports: string[] };
export type WebAuthnErrorCode = 'verification_failed' | 'counter_replay';

export class WebAuthnError extends Error {
  readonly code: WebAuthnErrorCode;
  constructor(code: WebAuthnErrorCode, options?: { cause?: unknown }) {
    super(code, options);
    this.name = 'WebAuthnError';
    this.code = code;
  }
}

export type VerifiedRegistration = {
  credentialId: string;
  publicKey: string;
  signCount: number;
  transports: string[];
};

export type StoredCredential = CredentialRef & { publicKey: string; signCount: number };

export interface WebAuthnPort {
  registrationOptions(input: {
    auth: AuthConfig;
    userId: string;
    kind: CredentialKind;
    existing: CredentialRef[];
  }): Promise<PublicKeyCredentialCreationOptionsJSON>;
  verifyRegistration(input: {
    auth: AuthConfig;
    expectedChallenge: string;
    response: RegistrationResponseJSON;
  }): Promise<VerifiedRegistration>;
  authenticationOptions(input: {
    auth: AuthConfig;
    allow?: CredentialRef[];
  }): Promise<PublicKeyCredentialRequestOptionsJSON>;
  verifyAuthentication(input: {
    auth: AuthConfig;
    expectedChallenge: string;
    response: AuthenticationResponseJSON;
    credential: StoredCredential;
  }): Promise<{ newSignCount: number }>;
}

const ALLOWED_TRANSPORTS = ['usb', 'nfc', 'ble', 'internal', 'hybrid', 'smart-card', 'cable'];

// Drop every transport value that the WebAuthn spec does not list. Drop repeated values.
export function sanitizeTransports(transports: readonly string[] | undefined): string[] {
  return [...new Set(transports ?? [])].filter((t) => ALLOWED_TRANSPORTS.includes(t));
}

// Both values 0 is fine: many passkey providers always send 0.
export function checkSignCount(stored: number, reported: number): boolean {
  if (stored === 0 && reported === 0) {
    return true;
  }
  return reported > stored;
}

function selectionFor(kind: CredentialKind) {
  if (kind === 'passkey') {
    return {
      authenticatorAttachment: 'platform',
      residentKey: 'required',
      userVerification: 'preferred',
    } as const;
  }
  return {
    authenticatorAttachment: 'cross-platform',
    residentKey: 'preferred',
    userVerification: 'preferred',
  } as const;
}

function toDescriptors(refs: CredentialRef[]) {
  return refs.map((c) => ({ id: c.credentialId, transports: c.transports }));
}

export const webAuthn: WebAuthnPort = {
  registrationOptions({ auth, userId, kind, existing }) {
    return generateRegistrationOptions({
      rpName: auth.rpName,
      rpID: auth.rpId,
      userName: 'srep',
      userDisplayName: 'srep owner',
      userID: isoBase64URL.toBuffer(userId),
      attestationType: 'none',
      timeout: 60000,
      excludeCredentials: toDescriptors(existing),
      authenticatorSelection: selectionFor(kind),
    });
  },

  async verifyRegistration({ auth, expectedChallenge, response }) {
    try {
      const result = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: auth.origin,
        expectedRPID: auth.rpId,
        requireUserPresence: true,
        requireUserVerification: false,
      });
      if (!result.verified) {
        throw new WebAuthnError('verification_failed');
      }
      const { credential } = result.registrationInfo;
      return {
        credentialId: credential.id,
        publicKey: isoBase64URL.fromBuffer(credential.publicKey),
        signCount: credential.counter,
        transports: sanitizeTransports(credential.transports),
      };
    } catch (error: unknown) {
      throw error instanceof WebAuthnError
        ? error
        : new WebAuthnError('verification_failed', { cause: error });
    }
  },

  authenticationOptions({ auth, allow }) {
    return generateAuthenticationOptions({
      rpID: auth.rpId,
      userVerification: 'preferred',
      allowCredentials: allow === undefined ? [] : toDescriptors(allow),
    });
  },

  async verifyAuthentication({ auth, expectedChallenge, response, credential }) {
    let reported: number;
    try {
      const result = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: auth.origin,
        expectedRPID: auth.rpId,
        requireUserVerification: false,
        // The counter is 0 here on purpose. The library check throws a generic error.
        // The check below gives the typed counter_replay code instead.
        credential: {
          id: credential.credentialId,
          publicKey: isoBase64URL.toBuffer(credential.publicKey),
          counter: 0,
          transports: credential.transports as never,
        },
      });
      if (!result.verified) {
        throw new WebAuthnError('verification_failed');
      }
      reported = result.authenticationInfo.newCounter;
    } catch (error: unknown) {
      throw error instanceof WebAuthnError
        ? error
        : new WebAuthnError('verification_failed', { cause: error });
    }
    if (!checkSignCount(credential.signCount, reported)) {
      throw new WebAuthnError('counter_replay');
    }
    return { newSignCount: reported };
  },
};
