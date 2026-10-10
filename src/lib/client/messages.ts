const MESSAGES: Record<string, string> = {
  setup_token_invalid: 'The setup token is not correct.',
  setup_locked: 'Setup is already done.',
  setup_required: 'Setup is not done yet.',
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

export function messageFor(code: string): string {
  return MESSAGES[code] ?? 'Something went wrong. Try again.';
}
