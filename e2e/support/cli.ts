import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');

export const E2E_ORIGIN = 'http://localhost:4173';

export function resetAuthViaCli(): string {
  const env = {
    ...process.env,
    SREP_DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'sqlite:./data/e2e.db',
    SREP_ORIGIN: E2E_ORIGIN,
    SREP_RP_ID: 'localhost',
  };
  const result = spawnSync('cargo', ['run', '-q', '-p', 'srep-cli', '--', 'reset-auth', '--yes'], {
    cwd: root,
    encoding: 'utf8',
    env,
  });
  const token = /^Setup token: (\S+)$/m.exec(result.stdout)?.[1];
  if (result.status !== 0 || token === undefined) {
    throw new Error(`reset-auth failed (${result.status}): ${result.stderr}`);
  }
  return token;
}
