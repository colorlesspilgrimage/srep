import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
const tsx = path.join(root, 'node_modules', '.bin', 'tsx');
const script = path.join(root, 'scripts', 'study-simulate.ts');

// An argument array and no shell. The script must always use an in-memory database.
function runSimulate(args: string[], databaseUrl = 'sqlite::memory:') {
  const env = { ...process.env, SREP_DATABASE_URL: databaseUrl, SREP_LOG_LEVEL: 'silent' };
  return spawnSync(tsx, [script, ...args], { cwd: root, env, encoding: 'utf8', input: '' });
}

// Each case starts tsx. A loaded host needs more than the default 5 s.
describe('study simulation script', { timeout: 30_000 }, () => {
  it('runs 20 days and prints a last line with zero violations', () => {
    const result = runSimulate(['--days', '20']);
    expect(result.status).toBe(0);
    const lines = result.stdout.trim().split('\n');
    const last = JSON.parse(lines.at(-1) ?? '{}') as Record<string, number>;
    expect(last).toMatchObject({
      days: 20,
      limitViolations: 0,
      replayMismatches: 0,
      undoMismatches: 0,
    });
    expect(last.reviews).toBeGreaterThan(0);
  });

  it.each([['0'], ['abc'], ['3651'], ['-1']])('exits with 2 for --days %s', (days) => {
    const result = runSimulate(['--days', days]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Usage');
  });

  it('exits with 2 for an unknown option', () => {
    const result = runSimulate(['--nope']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Usage');
  });

  // CWE-1188: the Docker image sets SREP_DATABASE_URL. The simulation must not write to it.
  it('never opens the database of SREP_DATABASE_URL', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srep-simulate-'));
    try {
      const realDatabase = path.join(dir, 'srep.db');
      const result = runSimulate(['--days', '1'], `sqlite:${realDatabase}`);
      expect(result.status).toBe(0);
      expect(fs.existsSync(realDatabase)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
