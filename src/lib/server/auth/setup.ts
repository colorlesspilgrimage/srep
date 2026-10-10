import { createChallenge, takeChallenge } from '#lib/server/auth/challenges.js';
import { toPublicCredential, type PublicCredential } from '#lib/server/auth/credentials.js';
import { fail, type AuthDeps, type Failure, type Result } from '#lib/server/auth/deps.js';
import { normalizeNickname } from '#lib/server/auth/nickname.js';
import { generateRecoveryCodes, hashRecoveryCode } from '#lib/server/auth/recovery-codes.js';
import type { CredentialRow } from '#lib/server/auth/store.js';
import { buildSession } from '#lib/server/auth/sessions.js';
import { randomToken, safeEqual, sha256Hex } from '#lib/server/auth/tokens.js';
import { WebAuthnError, type CredentialKind } from '#lib/server/auth/webauthn.js';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';

// The lock check comes first. Then the token check, in constant time.
async function checkSetupAccess(deps: AuthDeps, setupToken: string): Promise<Failure | null> {
  if (await deps.store.isSetupComplete()) {
    return fail(403, 'setup_locked');
  }
  const stored = await deps.store.getSetupTokenHash();
  if (stored === null || !safeEqual(sha256Hex(setupToken), stored)) {
    return fail(403, 'setup_token_invalid');
  }
  return null;
}

export async function ensureSetupToken(deps: AuthDeps): Promise<string | null> {
  if (await deps.store.isSetupComplete()) {
    return null;
  }
  const token = randomToken(32, deps.random);
  await deps.store.armSetup(sha256Hex(token));
  return token;
}

export async function setupOptions(
  deps: AuthDeps,
  input: { setupToken: string; kind: CredentialKind; nickname: string },
): Promise<Result<{ options: PublicKeyCredentialCreationOptionsJSON; challengeId: string }>> {
  const denied = await checkSetupAccess(deps, input.setupToken);
  if (denied !== null) {
    return denied;
  }
  if (normalizeNickname(input.nickname) === null) {
    return fail(400, 'invalid_nickname');
  }
  const userId = await deps.store.getOrCreateUserId(randomToken(32, deps.random));
  const options = await deps.webauthn.registrationOptions({
    auth: deps.auth,
    userId,
    kind: input.kind,
    existing: [],
  });
  const challengeId = await createChallenge(deps, 'setup', options.challenge);
  return { ok: true, options, challengeId };
}

export type SetupVerifyInput = {
  setupToken: string;
  challengeId: string;
  response: RegistrationResponseJSON;
  kind: CredentialKind;
  nickname: string;
  userAgent: string;
};

export type SetupVerifyOk = {
  credential: PublicCredential;
  recoveryCodes: string[];
  sessionToken: string;
  maxAgeSec: number;
};

async function verifyNewCredential(
  deps: AuthDeps,
  input: SetupVerifyInput,
  nickname: string,
): Promise<{ ok: true; row: CredentialRow } | Failure> {
  const taken = await takeChallenge(deps, input.challengeId, 'setup');
  if (!taken.ok) {
    return taken;
  }
  try {
    const verified = await deps.webauthn.verifyRegistration({
      auth: deps.auth,
      expectedChallenge: taken.challenge,
      response: input.response,
    });
    const row: CredentialRow = {
      id: crypto.randomUUID(),
      credentialId: verified.credentialId,
      publicKey: verified.publicKey,
      signCount: verified.signCount,
      transports: verified.transports,
      kind: input.kind,
      nickname,
      createdAt: deps.now(),
      lastUsedAt: null,
    };
    return { ok: true, row };
  } catch (error: unknown) {
    if (error instanceof WebAuthnError) {
      deps.logger.warn({ code: error.code }, 'setup registration failed');
      return fail(400, 'verification_failed');
    }
    throw error;
  }
}

export async function setupVerify(
  deps: AuthDeps,
  input: SetupVerifyInput,
): Promise<Result<SetupVerifyOk>> {
  const denied = await checkSetupAccess(deps, input.setupToken);
  if (denied !== null) {
    return denied;
  }
  const nickname = normalizeNickname(input.nickname);
  if (nickname === null) {
    return fail(400, 'invalid_nickname');
  }
  const created = await verifyNewCredential(deps, input, nickname);
  if (!created.ok) {
    return created;
  }
  const recoveryCodes = generateRecoveryCodes(10, deps.random);
  const recoveryHashes = recoveryCodes.map((code) => ({
    id: crypto.randomUUID(),
    codeHash: hashRecoveryCode(code),
  }));
  const session = buildSession(deps, input.userAgent);
  const done = await deps.store.completeSetup({
    credential: created.row,
    recoveryHashes,
    session: session.row,
    now: deps.now(),
  });
  if (!done.ok) {
    return fail(403, 'setup_locked');
  }
  return {
    ok: true,
    credential: toPublicCredential(created.row),
    recoveryCodes,
    sessionToken: session.rawToken,
    maxAgeSec: session.maxAgeSec,
  };
}
