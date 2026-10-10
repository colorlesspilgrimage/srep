import readline from 'node:readline/promises';
import crypto from 'node:crypto';
import { parseCliArgs, USAGE } from '../src/lib/server/auth/cli-args.ts';
import { resetAuth } from '../src/lib/server/auth/reset.ts';
import { getAuthStore } from '../src/lib/server/auth/store.ts';
import { getConfig, type Config } from '../src/lib/server/config.ts';
import { createDb, type DbHandle } from '../src/lib/server/db/client.ts';
import { runMigrations } from '../src/lib/server/db/migrate.ts';

const EXIT_USAGE = 2;

async function confirm(): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question('Type "reset" to continue: ');
    return answer.trim() === 'reset';
  } finally {
    rl.close();
  }
}

function describeReset(): void {
  console.log('This removes all credentials, recovery codes and sessions.');
  console.log('Setup opens again. A new setup token is printed.');
}

async function runResetAuth(config: Config, yes: boolean): Promise<number> {
  if (!yes && !process.stdin.isTTY) {
    console.error('Input is not a terminal. Use --yes to confirm.');
    return EXIT_USAGE;
  }
  describeReset();
  if (!yes && !(await confirm())) {
    console.error('Cancelled. Nothing changed.');
    return 1;
  }
  let db: DbHandle | undefined;
  try {
    db = createDb(config);
    // The migration log stays silent, so stdout holds only the two result lines.
    await runMigrations(db, config, { info: () => undefined });
    const token = await resetAuth({ store: getAuthStore(db), random: crypto.randomBytes });
    console.log(`Setup token: ${token}`);
    console.log(`Open ${config.auth.origin}/setup to enroll a new credential.`);
    return 0;
  } finally {
    await db?.close().catch(() => undefined);
  }
}

async function main(): Promise<number> {
  const args = parseCliArgs(process.argv.slice(2));
  if ('help' in args) {
    console.log(USAGE);
    return 0;
  }
  if ('error' in args) {
    console.error(`${args.error}\n\n${USAGE}`);
    return EXIT_USAGE;
  }
  try {
    return await runResetAuth(getConfig(), args.yes);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : 'reset-auth failed');
    return 1;
  }
}

process.exitCode = await main();
