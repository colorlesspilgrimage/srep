import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getAuthStore } from '../src/lib/server/auth/store.ts';
import { sha256Hex } from '../src/lib/server/auth/tokens.ts';
import { parseConfig } from '../src/lib/server/config.ts';
import { createDb } from '../src/lib/server/db/client.ts';
import { makeTempDir, removeTempDirs } from '../src/lib/server/temp-dir.ts';

const root = path.resolve(import.meta.dirname, '..');
const tsx = path.join(root, 'node_modules', '.bin', 'tsx');
const script = path.join(root, 'scripts', 'srep.ts');
const dirs: string[] = [];

function runSrep(args: string[], databaseUrl: string) {
  const env = {
    ...process.env,
    SREP_DATABASE_URL: databaseUrl,
    SREP_ORIGIN: 'http://localhost:3000',
  };
  return spawnSync(tsx, [script, ...args], { cwd: root, env, encoding: 'utf8', input: '' });
}

function tokenOf(stdout: string): string {
  return /^Setup token: (\S+)$/m.exec(stdout)?.[1] ?? '';
}

afterEach(() => {
  removeTempDirs(dirs);
});

describe('srep reset-auth', () => {
  it('prints a setup token and the setup address, and exits with 0', () => {
    const dir = makeTempDir(dirs);
    const result = runSrep(['reset-auth', '--yes'], `sqlite:${path.join(dir, 'cli.db')}`);
    expect(result.status).toBe(0);
    expect(tokenOf(result.stdout).length).toBeGreaterThan(20);
    expect(result.stdout).toContain('Open http://localhost:3000/setup to enroll a new credential.');
  });

  it('gives a different token on each run and arms the stored hash', async () => {
    const dir = makeTempDir(dirs);
    const file = path.join(dir, 'cli.db');
    const first = tokenOf(runSrep(['reset-auth', '-y'], `sqlite:${file}`).stdout);
    const second = tokenOf(runSrep(['reset-auth', '-y'], `sqlite:${file}`).stdout);
    expect(first).not.toBe(second);
    const config = parseConfig({ SREP_DATABASE_URL: `sqlite:${file}` });
    const db = createDb(config);
    expect(await getAuthStore(db).getSetupTokenHash()).toBe(sha256Hex(second));
    await db.close();
  });

  it('exits with 2 and changes nothing without --yes and without a terminal', () => {
    const dir = makeTempDir(dirs);
    const file = path.join(dir, 'cli.db');
    const result = runSrep(['reset-auth'], `sqlite:${file}`);
    expect(result.status).toBe(2);
    expect(result.stdout).not.toContain('Setup token');
    expect(fs.existsSync(file)).toBe(false);
  });

  it('exits with 2 and prints usage for an unknown command or option', () => {
    const dir = makeTempDir(dirs);
    const url = `sqlite:${path.join(dir, 'cli.db')}`;
    for (const args of [['nope'], ['reset-auth', '--force'], []]) {
      const result = runSrep(args, url);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('Usage: srep');
    }
  });

  it('prints the help text and exits with 0', () => {
    const result = runSrep(['--help'], 'sqlite::memory:');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('reset-auth');
  });

  it('keeps the database file private', () => {
    const dir = makeTempDir(dirs);
    const file = path.join(dir, 'private', 'cli.db');
    runSrep(['reset-auth', '--yes'], `sqlite:${file}`);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
  });

  it('exits with 1 and names the variable for a bad origin', () => {
    const dir = makeTempDir(dirs);
    const env = {
      ...process.env,
      SREP_DATABASE_URL: `sqlite:${path.join(dir, 'x.db')}`,
      SREP_ORIGIN: 'http://example.com',
    };
    const result = spawnSync(tsx, [script, 'reset-auth', '--yes'], {
      cwd: root,
      env,
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SREP_ORIGIN');
  });
});
