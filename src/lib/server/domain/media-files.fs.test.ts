import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFsMediaFiles } from '#lib/server/domain/media-files.fs.js';
import { makeTempDir, removeTempDirs } from '#lib/server/temp-dir.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) {
    fs.chmodSync(path.join(dir, 'ab'), 0o700);
  }
  removeTempDirs(dirs);
});

const SHA = 'ab' + '0'.repeat(62);

// A failed write must not leave a temp file. Many failed writes would fill the disk (CWE-459).
// Root ignores the folder mode, so the test needs a normal user.
const canDenyWrite = process.platform !== 'win32' && process.getuid?.() !== 0;

describe('createFsMediaFiles', () => {
  it.skipIf(!canDenyWrite)('removes the temp file when the rename fails (CWE-459)', async () => {
    const dir = makeTempDir(dirs);
    fs.mkdirSync(path.join(dir, 'ab'), { mode: 0o500 });
    const files = createFsMediaFiles(dir);
    await expect(files.write(SHA, Buffer.from('data'))).rejects.toThrow();
    expect(fs.readdirSync(path.join(dir, 'tmp'))).toEqual([]);
    expect(await files.read(SHA)).toBeNull();
  });

  it('refuses a sha that is not 64 lower-case hex characters (CWE-22)', async () => {
    const dir = makeTempDir(dirs);
    fs.mkdirSync(path.join(dir, 'ab'), { mode: 0o700 });
    const files = createFsMediaFiles(dir);
    await expect(files.write('../../etc/passwd', Buffer.from('x'))).rejects.toThrow();
    await expect(files.read('AB' + '0'.repeat(62))).rejects.toThrow();
  });
});
