import { getConfig } from '#lib/server/config.js';
import { getDomainContext } from '#lib/server/domain/context.js';
import { getDb } from '#lib/server/db/index.js';
import { getSnapshotStore } from '#lib/server/import-export/snapshot-store.js';
import { once } from '#lib/server/once.js';

export type ImportExportDeps = {
  snapshot: ReturnType<typeof getSnapshotStore>;
  domain: ReturnType<typeof getDomainContext>;
  now: () => number;
  importMaxBytes: number;
};

export const getImportExportDeps = once((): ImportExportDeps => {
  const config = getConfig();
  return {
    snapshot: getSnapshotStore(getDb()),
    domain: getDomainContext(),
    now: Date.now,
    importMaxBytes: config.importMaxBytes,
  };
});
