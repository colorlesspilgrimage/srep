export type CliArgs = { command: 'reset-auth'; yes: boolean } | { help: true } | { error: string };

export const USAGE = [
  'Usage: srep <command> [options]',
  '',
  'Commands:',
  '  reset-auth    Remove all credentials and sessions. Open setup again.',
  '',
  'Options:',
  '  -y, --yes     Skip the confirmation question.',
  '  --help        Show this text.',
].join('\n');

export function parseCliArgs(argv: string[]): CliArgs {
  let command: string | undefined;
  let yes = false;
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      return { help: true };
    }
    if (arg === '--yes' || arg === '-y') {
      yes = true;
    } else if (arg.startsWith('-')) {
      return { error: `unknown option: ${arg}` };
    } else if (command === undefined) {
      command = arg;
    } else {
      return { error: `unexpected argument: ${arg}` };
    }
  }
  if (command === undefined) {
    return { error: 'missing command' };
  }
  if (command !== 'reset-auth') {
    return { error: `unknown command: ${command}` };
  }
  return { command, yes };
}
