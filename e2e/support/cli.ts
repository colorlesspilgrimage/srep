import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');

export const E2E_ORIGIN = 'http://localhost:4173';

// Runs "srep reset-auth --yes" against the e2e database and returns the new setup token.
// The command uses an argument array and no shell.
export function resetAuthViaCli(): string {
  const result = spawnSync('npx', ['tsx', 'scripts/srep.ts', 'reset-auth', '--yes'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      SREP_DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'sqlite:./data/e2e.db',
      SREP_ORIGIN: E2E_ORIGIN,
    },
  });
  const token = /^Setup token: (\S+)$/m.exec(result.stdout)?.[1];
  if (result.status !== 0 || token === undefined) {
    throw new Error(`reset-auth failed (${result.status}): ${result.stderr}`);
  }
  return token;
}
