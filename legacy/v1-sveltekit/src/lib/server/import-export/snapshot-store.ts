import type { DbHandle } from '#lib/server/db/client.js';
import { applyPgSnapshot } from '#lib/server/import-export/snapshot-write.pg.js';
import { applySqliteSnapshot } from '#lib/server/import-export/snapshot-write.sqlite.js';
import { readPgSnapshot } from '#lib/server/import-export/snapshot-read.pg.js';
import { readSqliteSnapshot } from '#lib/server/import-export/snapshot-read.sqlite.js';
import type { NativeManifest } from '#lib/server/import-export/types.js';

export type SnapshotStore = {
  readSnapshot(exportedAt: number): Promise<NativeManifest>;
  applySnapshot(manifest: NativeManifest): Promise<void>;
};

export function getSnapshotStore(handle: DbHandle): SnapshotStore {
  if (handle.dialect === 'sqlite') {
    const db = handle.db;
    return {
      async readSnapshot(exportedAt) {
        return readSqliteSnapshot(db, exportedAt);
      },
      async applySnapshot(manifest) {
        applySqliteSnapshot(db, manifest);
      },
    };
  }
  const db = handle.db;
  return {
    readSnapshot: (exportedAt) => readPgSnapshot(db, exportedAt),
    applySnapshot: (manifest) => applyPgSnapshot(db, manifest),
  };
}
