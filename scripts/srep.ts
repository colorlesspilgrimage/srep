import readline from 'node:readline/promises';
import crypto from 'node:crypto';
import { parseCliArgs, USAGE } from '../src/lib/server/auth/cli-args.ts';
import { resetAuth } from '../src/lib/server/auth/reset.ts';
import { getAuthStore } from '../src/lib/server/auth/store.ts';
import { getConfig, type Config } from '../src/lib/server/config.ts';
import { createDb, type DbHandle } from '../src/lib/server/db/client.ts';
import { runMigrations } from '../src/lib/server/db/migrate.ts';
import { backupSqlite, restoreSqlite } from '../src/lib/server/import-export/backup-cli.ts';

const EXIT_USAGE = 2;

async function confirm(word: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`Type "${word}" to continue: `);
    return answer.trim() === word;
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
  if (!yes && !(await confirm('reset'))) {
    console.error('Cancelled. Nothing changed.');
    return 1;
  }
  let db: DbHandle | undefined;
  try {
    db = createDb(config);
    await runMigrations(db, config, { info: () => undefined });
    const token = await resetAuth({ store: getAuthStore(db), random: crypto.randomBytes });
    console.log(`Setup token: ${token}`);
    console.log(`Open ${config.auth.origin}/setup to enroll a new credential.`);
    return 0;
  } finally {
    await db?.close().catch(() => undefined);
  }
}

async function runBackup(config: Config, out: string): Promise<number> {
  if (config.database.dialect !== 'sqlite') {
    console.error(
      'backup is implemented for SQLite only. Use pg_dump and copy the media folder for Postgres.',
    );
    return 1;
  }
  await backupSqlite(config, out, Date.now());
  console.log(`Wrote ${out}`);
  return 0;
}

async function runRestore(config: Config, from: string, yes: boolean): Promise<number> {
  if (config.database.dialect !== 'sqlite') {
    console.error('restore is implemented for SQLite only.');
    return 1;
  }
  if (!yes && !process.stdin.isTTY) {
    console.error('Input is not a terminal. Use --yes to confirm.');
    return EXIT_USAGE;
  }
  console.log('This replaces collection tables and media files. Credentials are kept.');
  if (!yes && !(await confirm('restore'))) {
    console.error('Cancelled. Nothing changed.');
    return 1;
  }
  await restoreSqlite(config, from);
  console.log(`Restored from ${from}`);
  return 0;
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
  const config = getConfig();
  try {
    if (args.command === 'reset-auth') {
      return await runResetAuth(config, args.yes);
    }
    if (args.command === 'backup') {
      return await runBackup(config, args.out);
    }
    return await runRestore(config, args.from, args.yes);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : 'command failed');
    return 1;
  }
}

process.exitCode = await main();
