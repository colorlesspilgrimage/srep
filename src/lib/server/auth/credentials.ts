import { createChallenge, takeChallenge } from '#lib/server/auth/challenges.js';
import { fail, type AuthDeps, type Failure, type Result } from '#lib/server/auth/deps.js';
import { normalizeNickname } from '#lib/server/auth/nickname.js';
import type { CredentialRow } from '#lib/server/auth/store.js';
import { randomToken } from '#lib/server/auth/tokens.js';
import { WebAuthnError, type CredentialKind } from '#lib/server/auth/webauthn.js';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';

export type PublicCredential = {
  id: string;
  nickname: string;
  kind: CredentialKind;
  createdAt: number;
  lastUsedAt: number | null;
  transports: string[];
};

// The public view never holds the credential id or the public key.
export function toPublicCredential(row: CredentialRow): PublicCredential {
  return {
    id: row.id,
    nickname: row.nickname,
    kind: row.kind,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    transports: row.transports,
  };
}

export async function listCredentials(deps: AuthDeps): Promise<PublicCredential[]> {
  return (await deps.store.listCredentials()).map(toPublicCredential);
}

export async function renameCredential(
  deps: AuthDeps,
  id: string,
  nickname: string,
): Promise<{ ok: true } | Failure> {
  const clean = normalizeNickname(nickname);
  if (clean === null) {
    return fail(400, 'invalid_nickname');
  }
  const renamed = await deps.store.renameCredential(id, clean);
  return renamed ? { ok: true } : fail(404, 'not_found');
}

// A revoke does not end other sessions. Use "log out everywhere" for that.
export async function revokeCredential(
  deps: AuthDeps,
  id: string,
): Promise<{ ok: true } | Failure> {
  const result = await deps.store.deleteCredentialUnlessLast(id);
  if (result === 'deleted') {
    return { ok: true };
  }
  return result === 'not_found' ? fail(404, 'not_found') : fail(409, 'last_credential');
}

export async function registerOptions(
  deps: AuthDeps,
  input: { kind: CredentialKind; nickname: string },
): Promise<Result<{ options: PublicKeyCredentialCreationOptionsJSON; challengeId: string }>> {
  if (normalizeNickname(input.nickname) === null) {
    return fail(400, 'invalid_nickname');
  }
  const userId = await deps.store.getOrCreateUserId(randomToken(32, deps.random));
  const existing = (await deps.store.listCredentials()).map((c) => ({
    credentialId: c.credentialId,
    transports: c.transports,
  }));
  const options = await deps.webauthn.registrationOptions({
    auth: deps.auth,
    userId,
    kind: input.kind,
    existing,
  });
  const challengeId = await createChallenge(deps, 'register', options.challenge);
  return { ok: true, options, challengeId };
}

export async function registerVerify(
  deps: AuthDeps,
  input: {
    challengeId: string;
    response: RegistrationResponseJSON;
    kind: CredentialKind;
    nickname: string;
  },
): Promise<Result<{ credential: PublicCredential }>> {
  const nickname = normalizeNickname(input.nickname);
  if (nickname === null) {
    return fail(400, 'invalid_nickname');
  }
  const taken = await takeChallenge(deps, input.challengeId, 'register');
  if (!taken.ok) {
    return taken;
  }
  try {
    const verified = await deps.webauthn.verifyRegistration({
      auth: deps.auth,
      expectedChallenge: taken.challenge,
      response: input.response,
    });
    if ((await deps.store.getCredentialByCredentialId(verified.credentialId)) !== undefined) {
      return fail(409, 'duplicate_credential');
    }
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
    await deps.store.insertCredential(row);
    return { ok: true, credential: toPublicCredential(row) };
  } catch (error: unknown) {
    if (error instanceof WebAuthnError) {
      deps.logger.warn({ code: error.code }, 'credential registration failed');
      return fail(400, 'verification_failed');
    }
    throw error;
  }
}
