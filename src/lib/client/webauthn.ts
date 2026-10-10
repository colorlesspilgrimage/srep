import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/browser';

export type Ceremony<T> = { ok: true; value: T } | { ok: false; message: string };

function describeError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  if (name === 'InvalidStateError' || code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
    return 'This authenticator is already enrolled.';
  }
  if (name === 'NotAllowedError' || code === 'ERROR_CEREMONY_ABORTED') {
    return 'The request was cancelled or timed out.';
  }
  return 'The authenticator could not finish the request.';
}

async function run<T>(start: () => Promise<T>): Promise<Ceremony<T>> {
  if (!browserSupportsWebAuthn()) {
    return { ok: false, message: 'This browser does not support passkeys.' };
  }
  try {
    return { ok: true, value: await start() };
  } catch (error: unknown) {
    return { ok: false, message: describeError(error) };
  }
}

export function register(
  optionsJSON: PublicKeyCredentialCreationOptionsJSON,
): Promise<Ceremony<RegistrationResponseJSON>> {
  return run(() => startRegistration({ optionsJSON }));
}

export function authenticate(
  optionsJSON: PublicKeyCredentialRequestOptionsJSON,
): Promise<Ceremony<AuthenticationResponseJSON>> {
  return run(() => startAuthentication({ optionsJSON }));
}
