const MESSAGES = new Map<string, string>([
  ['deck_name_taken', 'That deck name is already used.'],
  ['bad_request', 'The deck name is not valid.'],
  ['not_found', 'That deck was not found.'],
  ['deck_cycle', 'That move would make a cycle.'],
  ['network_error', 'The server did not answer.'],
  ['unauthenticated', 'Sign in and try again.'],
]);

export function appMessageFor(code: string): string {
  return MESSAGES.get(code) ?? 'The request failed.';
}
