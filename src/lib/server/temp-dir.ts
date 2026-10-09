import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function makeTempDir(dirs: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srep-'));
  dirs.push(dir);
  return dir;
}

export function removeTempDirs(dirs: string[]): void {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
