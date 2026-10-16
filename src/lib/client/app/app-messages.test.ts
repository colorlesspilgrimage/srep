import { describe, expect, it } from 'vitest';
import { appMessageFor } from './app-messages.js';

describe('appMessageFor', () => {
  it('maps each known code and uses the default sentence', () => {
    expect(appMessageFor('deck_name_taken')).toBe('That deck name is already used.');
    expect(appMessageFor('bad_request')).toBe('The deck name is not valid.');
    expect(appMessageFor('not_found')).toBe('That deck was not found.');
    expect(appMessageFor('deck_cycle')).toBe('That move would make a cycle.');
    expect(appMessageFor('network_error')).toBe('The server did not answer.');
    expect(appMessageFor('unauthenticated')).toBe('Sign in and try again.');
    expect(appMessageFor('other')).toBe('The request failed.');
  });
});
