export type CliArgs =
  | { command: 'reset-auth'; yes: boolean }
  | { command: 'backup'; out: string }
  | { command: 'restore'; from: string; yes: boolean }
  | { help: true }
  | { error: string };

export const USAGE = [
  'Usage: srep <command> [options]',
  '',
  'Commands:',
  '  reset-auth    Remove all credentials and sessions. Open setup again.',
  '  backup        Write a native archive of domain data and media.',
  '  restore       Replace domain data from a native archive. Stop the server first.',
  '',
  'Options:',
  '  --out <path>   Output path for backup.',
  '  --from <path>  Input archive for restore.',
  '  -y, --yes      Skip the confirmation question.',
  '  --help         Show this text.',
].join('\n');

function readFlagValue(argv: string[], index: number, flag: string): string | { error: string } {
  const arg = argv[index];
  if (arg === undefined) {
    return { error: `missing value for ${flag}` };
  }
  if (arg.startsWith('-')) {
    return { error: `missing value for ${flag}` };
  }
  return arg;
}

export function parseCliArgs(argv: string[]): CliArgs {
  let command: string | undefined;
  let yes = false;
  let out: string | undefined;
  let from: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--help' || arg === '-h') {
      return { help: true };
    }
    if (arg === '--yes' || arg === '-y') {
      yes = true;
      continue;
    }
    if (arg === '--out') {
      const value = readFlagValue(argv, index + 1, arg);
      if (typeof value === 'object') {
        return value;
      }
      out = value;
      index += 1;
      continue;
    }
    if (arg === '--from') {
      const value = readFlagValue(argv, index + 1, arg);
      if (typeof value === 'object') {
        return value;
      }
      from = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('-')) {
      return { error: `unknown option: ${arg}` };
    }
    if (command === undefined) {
      command = arg;
    } else {
      return { error: `unexpected argument: ${arg}` };
    }
  }
  if (command === undefined) {
    return { error: 'missing command' };
  }
  if (command === 'reset-auth') {
    return { command, yes };
  }
  if (command === 'backup') {
    if (out === undefined) {
      return { error: 'backup requires --out <path>' };
    }
    return { command, out };
  }
  if (command === 'restore') {
    if (from === undefined) {
      return { error: 'restore requires --from <path>' };
    }
    return { command, from, yes };
  }
  return { error: `unknown command: ${command}` };
}
