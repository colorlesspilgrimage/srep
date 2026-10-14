import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Contract: run drizzle-kit generate for one fixed config.
// Input is the config name sqlite or pg.
// The child env sets TSX_DISABLE_CACHE to 1.
// That flag stops the shared tsx temp cache.
// A bad name exits 1.
// The runner does not use a shell.

const root = path.resolve(import.meta.dirname, '..');

const DB_GENERATE_CONFIGS = Object.create(null);
DB_GENERATE_CONFIGS.sqlite = 'drizzle.sqlite.config.ts';
DB_GENERATE_CONFIGS.pg = 'drizzle.pg.config.ts';

export function dbGenerateCommand(configName) {
  if (typeof configName !== 'string' || !Object.hasOwn(DB_GENERATE_CONFIGS, configName)) {
    return null;
  }
  return {
    program: process.execPath,
    args: [
      path.join(root, 'node_modules', 'drizzle-kit', 'bin.cjs'),
      'generate',
      '--config',
      DB_GENERATE_CONFIGS[configName],
    ],
    env: { TSX_DISABLE_CACHE: '1' },
  };
}

export function runDbGenerate(configName) {
  const command = dbGenerateCommand(configName);
  if (command === null) {
    return 1;
  }
  const result = spawnSync(command.program, command.args, {
    cwd: root,
    env: { ...process.env, ...command.env },
    stdio: 'inherit',
    shell: false,
    timeout: 90_000,
  });
  return result.status ?? 1;
}

function isDirectRun() {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isDirectRun()) {
  process.exit(runDbGenerate(process.argv[2]));
}
