import { describe, expect, it } from 'vitest';
import { parseCliArgs } from '#lib/server/auth/cli-args.js';

describe('parseCliArgs', () => {
  it('parses reset-auth', () => {
    expect(parseCliArgs(['reset-auth'])).toEqual({ command: 'reset-auth', yes: false });
    expect(parseCliArgs(['reset-auth', '--yes'])).toEqual({ command: 'reset-auth', yes: true });
    expect(parseCliArgs(['-y', 'reset-auth'])).toEqual({ command: 'reset-auth', yes: true });
  });

  it('parses help', () => {
    expect(parseCliArgs(['--help'])).toEqual({ help: true });
    expect(parseCliArgs(['reset-auth', '-h'])).toEqual({ help: true });
  });

  it.each([[[]], [['nope']], [['reset-auth', '--force']], [['reset-auth', 'extra']]])(
    'returns an error for %j',
    (argv) => {
      expect(parseCliArgs(argv)).toHaveProperty('error');
    },
  );
});
