import { accessSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

try {
  accessSync(new URL('../vite.config.ts', import.meta.url));
} catch {
  process.exit(0);
}

const result = spawnSync('svelte-kit', ['sync'], { stdio: 'inherit', shell: true });
process.exit(result.status ?? 1);
