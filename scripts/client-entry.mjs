import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';

let csrfToken = null;

const MESSAGES = {
  setup_token_invalid: 'The setup token is not correct.',
  setup_locked: 'Setup is already done.',
  rate_limited: 'Too many attempts. Wait a few minutes and try again.',
  verification_failed: 'The browser answer was not accepted. Try again.',
  login_failed: 'Login failed.',
  recovery_failed: 'The recovery code is not valid or was used before.',
  no_security_key: 'No security key is enrolled.',
  challenge_expired: 'The request expired. Try again.',
  challenge_invalid: 'The request is not valid. Try again.',
  invalid_nickname: 'The nickname must have 1 to 64 characters.',
  duplicate_credential: 'This credential is already enrolled.',
  last_credential: 'You cannot remove your last credential.',
  network_error: 'The server did not answer.',
};

function messageFor(code) {
  return MESSAGES[code] ?? 'Something went wrong. Try again.';
}

function errorCodeOf(body) {
  if (body && typeof body === 'object' && typeof body.error === 'string') {
    return body.error;
  }
  return 'error';
}

export function setCsrfToken(token) {
  csrfToken = token;
}

export function getCsrfToken() {
  return csrfToken;
}

function csrfHeaders() {
  if (!csrfToken) {
    return {};
  }
  return { 'x-srep-csrf': csrfToken };
}

export async function apiFetch(path, init = {}) {
  const headers = {
    'content-type': 'application/json',
    ...csrfHeaders(),
    ...(init.headers ?? {}),
  };
  const method = init.method ?? 'GET';
  const body = init.body === undefined ? undefined : JSON.stringify(init.body);
  let response;
  try {
    response = await fetch(path, { method, headers, body, credentials: 'same-origin' });
  } catch {
    return { ok: false, status: 0, error: 'network_error' };
  }
  const parsed = await response.json().catch(() => null);
  if (!response.ok) {
    return { ok: false, status: response.status, error: errorCodeOf(parsed) };
  }
  return { ok: true, status: response.status, body: parsed };
}

function describeCeremonyError(error) {
  const name = error instanceof Error ? error.name : '';
  if (name === 'InvalidStateError') {
    return 'This authenticator is already enrolled.';
  }
  if (name === 'NotAllowedError') {
    return 'The request was cancelled or timed out.';
  }
  return 'The authenticator could not finish the request.';
}

async function runCeremony(start) {
  if (!browserSupportsWebAuthn()) {
    return { ok: false, message: 'This browser does not support passkeys.' };
  }
  try {
    return { ok: true, value: await start() };
  } catch (error) {
    return { ok: false, message: describeCeremonyError(error) };
  }
}

async function enroll(base, fields) {
  const first = await apiFetch(`${base}/options`, { method: 'POST', body: fields });
  if (!first.ok) {
    return { ok: false, message: messageFor(first.error) };
  }
  const reg = await runCeremony(() => startRegistration({ optionsJSON: first.body.options }));
  if (!reg.ok) {
    return { ok: false, message: reg.message };
  }
  const verifyBody = { ...fields, challengeId: first.body.challengeId, response: reg.value };
  if (verifyBody.setupToken !== undefined) {
    /* keep camelCase setupToken */
  }
  const second = await apiFetch(`${base}/verify`, {
    method: 'POST',
    body: verifyBody,
  });
  return second.ok
    ? { ok: true, body: second.body }
    : { ok: false, message: messageFor(second.error) };
}

async function loginWith(kind) {
  const first = await apiFetch('/api/auth/login/options', {
    method: 'POST',
    body: { kind },
  });
  if (!first.ok) {
    return { ok: false, message: messageFor(first.error) };
  }
  const auth = await runCeremony(() => startAuthentication({ optionsJSON: first.body.options }));
  if (!auth.ok) {
    return { ok: false, message: auth.message };
  }
  const second = await apiFetch('/api/auth/login/verify', {
    method: 'POST',
    body: { challengeId: first.body.challengeId, response: auth.value },
  });
  if (!second.ok) {
    return { ok: false, message: messageFor(second.error) };
  }
  setCsrfToken(second.body.csrfToken);
  return { ok: true, body: null };
}

async function recoveryLogin(code) {
  const result = await apiFetch('/api/auth/recovery/login', {
    method: 'POST',
    body: { code },
  });
  if (!result.ok) {
    return { ok: false, message: messageFor(result.error) };
  }
  setCsrfToken(result.body.csrfToken);
  return { ok: true, body: result.body };
}

window.srepClient = {
  apiFetch,
  setCsrfToken,
  getCsrfToken,
  messageFor,
  enroll,
  loginWith,
  recoveryLogin,
};
