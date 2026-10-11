import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeTempDir, removeTempDirs } from '../src/lib/server/temp-dir.ts';

const root = path.resolve(import.meta.dirname, '..');
const tsx = path.join(root, 'node_modules', '.bin', 'tsx');
const script = path.join(root, 'scripts', 'domain-demo.ts');
const dirs: string[] = [];

// An argument array and no shell. The env holds only checked settings.
function runDemo(dir: string, args: string[] = []) {
  const env = {
    ...process.env,
    SREP_DATABASE_URL: `sqlite:${path.join(dir, 'demo.db')}`,
    SREP_MEDIA_DIR: path.join(dir, 'media'),
    SREP_LOG_LEVEL: 'silent',
  };
  const result = spawnSync(tsx, [script, ...args], { cwd: root, env, encoding: 'utf8', input: '' });
  const lines = result.stdout
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { result, lines };
}

afterEach(() => {
  removeTempDirs(dirs);
});

// Each case starts tsx. A loaded host needs more than the default 5 s.
describe('domain demo script', { timeout: 30_000 }, () => {
  it('creates decks and notes and prints the expected cards', () => {
    const { result, lines } = runDemo(makeTempDir(dirs));
    expect(result.status).toBe(0);
    expect(lines).toEqual([
      { step: 'deck', path: 'Languages' },
      { step: 'deck', path: 'Languages::Japanese' },
      { step: 'note', type: 'Basic', cards: 1, fronts: ['犬'] },
      { step: 'note', type: 'Basic+Reversed', cards: 2, fronts: ['犬', 'dog'] },
      {
        step: 'note',
        type: 'Cloze',
        cards: 2,
        fronts: [
          '<span class="cloze">[...]</span> is the capital of Japan',
          'Tokyo is the capital of <span class="cloze">[...]</span>',
        ],
      },
      { step: 'rename', paths: ['Lang', 'Lang::Japanese'] },
    ]);
  });

  it('runs twice on one database with --unique', () => {
    const dir = makeTempDir(dirs);
    for (let run = 0; run < 2; run += 1) {
      const { result, lines } = runDemo(dir, ['--unique']);
      expect(result.status).toBe(0);
      expect(String(lines[0]?.path)).toMatch(/^Languages-\d+$/);
      expect(lines.map((line) => line.cards).filter(Boolean)).toEqual([1, 2, 2]);
    }
  });

  it('exits with 1 on a name clash and with 2 for an unknown option', () => {
    const dir = makeTempDir(dirs);
    expect(runDemo(dir).result.status).toBe(0);
    const clash = runDemo(dir).result;
    expect(clash.status).toBe(1);
    expect(clash.stderr).toContain('deck_name_taken');
    const bad = runDemo(dir, ['--nope']).result;
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain('Usage');
  });
});
