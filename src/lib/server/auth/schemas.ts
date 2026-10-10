import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { z } from 'zod';

const kind = z.enum(['passkey', 'security_key']);
const nickname = z.string().max(200);
const challengeId = z.string().min(1).max(64);
// The WebAuthn library checks the inner fields. The body size limit bounds the rest.
function looksLikeResponse(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || !('id' in value)) {
    return false;
  }
  const { id } = value;
  return typeof id === 'string' && id.length > 0 && id.length <= 1024;
}

const registrationResponse = z.custom<RegistrationResponseJSON>(looksLikeResponse);
const authenticationResponse = z.custom<AuthenticationResponseJSON>(looksLikeResponse);

export const setupOptionsSchema = z
  .object({ setupToken: z.string().max(256), kind, nickname })
  .strict();

export const setupVerifySchema = z
  .object({
    setupToken: z.string().max(256),
    challengeId,
    response: registrationResponse,
    kind,
    nickname,
  })
  .strict();

export const loginOptionsSchema = z.object({ kind: kind.optional() }).strict();

export const loginVerifySchema = z
  .object({ challengeId, response: authenticationResponse })
  .strict();

export const recoveryLoginSchema = z.object({ code: z.string().max(64) }).strict();

export const renameSchema = z.object({ nickname }).strict();

export const registerOptionsSchema = z.object({ kind, nickname }).strict();

export const registerVerifySchema = z
  .object({ challengeId, response: registrationResponse, kind, nickname })
  .strict();

export const credentialIdSchema = z.uuid();
