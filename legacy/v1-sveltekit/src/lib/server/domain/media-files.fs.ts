import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isSha256Hex } from '#lib/server/domain/core/media-rules.js';
import type { MediaFiles } from '#lib/server/domain/media-files.js';

function filePath(dir: string, sha: string): string {
  if (!isSha256Hex(sha)) {
    throw new Error('media: invalid sha256');
  }
  return path.join(dir, sha.slice(0, 2), sha);
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

export function createFsMediaFiles(dir: string): MediaFiles {
  return {
    async write(sha, bytes) {
      const target = filePath(dir, sha);
      const tmpDir = path.join(dir, 'tmp');
      await fs.mkdir(tmpDir, { recursive: true, mode: 0o700 });
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      const tmp = path.join(tmpDir, crypto.randomBytes(16).toString('hex'));
      try {
        await fs.writeFile(tmp, bytes, { mode: 0o600, flag: 'wx' });
        const present = await fs.access(target).then(
          () => true,
          (error: unknown) => {
            if (!isMissing(error)) {
              throw error;
            }
            return false;
          },
        );
        if (present) {
          await fs.rm(tmp, { force: true });
        } else {
          await fs.rename(tmp, target);
        }
      } catch (error) {
        await fs.rm(tmp, { force: true });
        throw error;
      }
    },

    async read(sha) {
      try {
        return await fs.readFile(filePath(dir, sha));
      } catch (error) {
        if (isMissing(error)) {
          return null;
        }
        throw error;
      }
    },
  };
}
