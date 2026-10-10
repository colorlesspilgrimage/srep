import { createChallenge, takeChallenge } from '#lib/server/auth/challenges.js';
import { fail, type AuthDeps, type Result } from '#lib/server/auth/deps.js';
import { createSession } from '#lib/server/auth/sessions.js';
import { WebAuthnError, type CredentialKind } from '#lib/server/auth/webauthn.js';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/server';

export async function loginOptions(
  deps: AuthDeps,
  input: { kind: CredentialKind },
): Promise<Result<{ options: PublicKeyCredentialRequestOptionsJSON; challengeId: string }>> {
  if (!(await deps.store.isSetupComplete())) {
    return fail(403, 'setup_required');
  }
  let allow: { credentialId: string; transports: string[] }[] | undefined;
  if (input.kind === 'security_key') {
    // A security key may not hold a discoverable credential. The list is needed.
    const keys = (await deps.store.listCredentials()).filter((c) => c.kind === 'security_key');
    if (keys.length === 0) {
      return fail(400, 'no_security_key');
    }
    allow = keys.map((c) => ({ credentialId: c.credentialId, transports: c.transports }));
  }
  const options = await deps.webauthn.authenticationOptions({ auth: deps.auth, allow });
  const challengeId = await createChallenge(deps, 'login', options.challenge);
  return { ok: true, options, challengeId };
}

// Every failure after the challenge check gives the same 401 (CWE-204).
export async function loginVerify(
  deps: AuthDeps,
  input: { challengeId: string; response: AuthenticationResponseJSON; userAgent: string },
): Promise<Result<{ sessionToken: string; maxAgeSec: number }>> {
  const taken = await takeChallenge(deps, input.challengeId, 'login');
  if (!taken.ok) {
    return taken;
  }
  const credential = await deps.store.getCredentialByCredentialId(input.response.id);
  if (credential === undefined) {
    return fail(401, 'login_failed');
  }
  let newSignCount: number;
  try {
    ({ newSignCount } = await deps.webauthn.verifyAuthentication({
      auth: deps.auth,
      expectedChallenge: taken.challenge,
      response: input.response,
      credential,
    }));
  } catch (error: unknown) {
    if (!(error instanceof WebAuthnError)) {
      throw error;
    }
    if (error.code === 'counter_replay') {
      deps.logger.warn({ credentialId: credential.id }, 'sign counter replay');
    }
    return fail(401, 'login_failed');
  }
  // A parallel login with the same counter loses here. It counts as a replay.
  if (!(await deps.store.updateSignCount(credential.id, newSignCount, deps.now()))) {
    deps.logger.warn({ credentialId: credential.id }, 'sign counter replay');
    return fail(401, 'login_failed');
  }
  const session = await createSession(deps, input.userAgent);
  return { ok: true, sessionToken: session.rawToken, maxAgeSec: session.maxAgeSec };
}
