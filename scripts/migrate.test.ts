import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeTempDir, removeTempDirs } from '../src/lib/server/temp-dir.ts';

const root = path.resolve(import.meta.dirname, '..');
const tsx = path.join(root, 'node_modules', '.bin', 'tsx');
const script = path.join(root, 'scripts', 'migrate.ts');
const dirs: string[] = [];

function runMigrate(databaseUrl: string) {
  const env = { ...process.env, SREP_DATABASE_URL: databaseUrl, SREP_LOG_LEVEL: 'info' };
  return spawnSync(tsx, [script], { cwd: root, env, encoding: 'utf8' });
}

afterEach(() => {
  removeTempDirs(dirs);
});

describe('db:migrate script', () => {
  it('applies migrations and exits with code 0', () => {
    const dir = makeTempDir(dirs);
    const result = runMigrate(`sqlite:${path.join(dir, 'cli.db')}`);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('migrations applied');
  });

  it('logs a JSON error and exits with code 1 when the database cannot open', () => {
    const dir = makeTempDir(dirs);
    // The path is a directory, so SQLite cannot open it as a file.
    const result = runMigrate(`sqlite:${dir}`);
    expect(result.status).toBe(1);
    const line = result.stdout.trim().split('\n').at(-1) ?? '{}';
    const row = JSON.parse(line) as { level?: number; msg?: string };
    expect(row.level).toBe(50);
    expect(row.msg).toBe('migration failed');
  });
});
