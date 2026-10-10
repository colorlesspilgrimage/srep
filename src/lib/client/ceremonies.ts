import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { apiFetch, setCsrfToken } from '#lib/client/api.js';
import { messageFor } from '#lib/client/messages.js';
import { authenticate, register } from '#lib/client/webauthn.js';

export type Kind = 'passkey' | 'security_key';
export type Outcome<T> = { ok: true; body: T } | { ok: false; message: string };

type OptionsBody<O> = { options: O; challengeId: string };

// Runs the two-step enrollment: ask for options, call the authenticator, verify.
export async function enroll<T>(
  base: '/api/auth/setup' | '/api/auth/credentials',
  fields: { kind: Kind; nickname: string; setupToken?: string },
): Promise<Outcome<T>> {
  const first = await apiFetch<OptionsBody<PublicKeyCredentialCreationOptionsJSON>>(
    `${base}/options`,
    { method: 'POST', body: fields },
  );
  if (!first.ok) {
    return { ok: false, message: messageFor(first.error) };
  }
  const answer = await register(first.body.options);
  if (!answer.ok) {
    return { ok: false, message: answer.message };
  }
  const second = await apiFetch<T>(`${base}/verify`, {
    method: 'POST',
    body: { ...fields, challengeId: first.body.challengeId, response: answer.value },
  });
  return second.ok
    ? { ok: true, body: second.body }
    : { ok: false, message: messageFor(second.error) };
}

// Logs in with a passkey or a security key. On success the CSRF token is stored.
export async function loginWith(kind: Kind): Promise<Outcome<null>> {
  const first = await apiFetch<OptionsBody<PublicKeyCredentialRequestOptionsJSON>>(
    '/api/auth/login/options',
    { method: 'POST', body: { kind } },
  );
  if (!first.ok) {
    return { ok: false, message: messageFor(first.error) };
  }
  const answer = await authenticate(first.body.options);
  if (!answer.ok) {
    return { ok: false, message: answer.message };
  }
  const second = await apiFetch<{ csrfToken: string }>('/api/auth/login/verify', {
    method: 'POST',
    body: { challengeId: first.body.challengeId, response: answer.value },
  });
  if (!second.ok) {
    return { ok: false, message: messageFor(second.error) };
  }
  setCsrfToken(second.body.csrfToken);
  return { ok: true, body: null };
}

// Ends the session on the server and forgets the CSRF token.
export async function signOut(everywhere: boolean): Promise<void> {
  await apiFetch(everywhere ? '/api/auth/logout-all' : '/api/auth/logout', { method: 'POST' });
  setCsrfToken(null);
}
