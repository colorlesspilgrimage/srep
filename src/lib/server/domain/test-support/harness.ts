import { sql } from 'drizzle-orm';
import { seededRandom, type Clock } from '#lib/server/auth/test-support/harness.js';
import { parseConfig } from '#lib/server/config.js';
import { createDb, type DbHandle } from '#lib/server/db/client.js';
import { runMigrations } from '#lib/server/db/migrate.js';
import type { DomainDeps } from '#lib/server/domain/deps.js';
import { createFsMediaFiles } from '#lib/server/domain/media-files.fs.js';
import { seedDomain } from '#lib/server/domain/seed.js';
import { getDomainStore } from '#lib/server/domain/store/store.js';
import type { DomainStore } from '#lib/server/domain/store/store-types.js';
import { makeTempDir, removeTempDirs } from '#lib/server/temp-dir.js';

export type DomainHarness = {
  deps: DomainDeps;
  store: DomainStore;
  handle: DbHandle;
  clock: Clock;
  mediaDir: string;
  close: () => Promise<void>;
};

export const DOMAIN_TABLES = [
  'deck_preset',
  'deck',
  'note_type',
  'card_template',
  'note',
  'note_tag',
  'card',
  'review_log',
  'media',
];

const silent = { info: () => undefined };

// The store is real. The clock is fixed, the random source is seeded, media is in a temp dir.
async function buildDomainHarness(handle: DbHandle, mediaMaxBytes: number): Promise<DomainHarness> {
  const dirs: string[] = [];
  const mediaDir = makeTempDir(dirs);
  const store = getDomainStore(handle);
  const clock: Clock = { now: 1_000_000 };
  const deps: DomainDeps = {
    store,
    media: createFsMediaFiles(mediaDir),
    now: () => clock.now,
    random: seededRandom(),
    limits: { mediaMaxBytes },
  };
  await seedDomain(deps);
  const close = async () => {
    await handle.close();
    removeTempDirs(dirs);
  };
  return { deps, store, handle, clock, mediaDir, close };
}

export async function createDomainHarness(mediaMaxBytes = 1024): Promise<DomainHarness> {
  const config = parseConfig({ SREP_DATABASE_URL: 'sqlite::memory:' });
  const handle = createDb(config);
  await runMigrations(handle, config, silent);
  return buildDomainHarness(handle, mediaMaxBytes);
}

// Every call starts with empty domain tables.
export async function createPgDomainHarness(url: string): Promise<DomainHarness> {
  const config = parseConfig({ SREP_DATABASE_URL: url });
  const handle = createDb(config);
  await runMigrations(handle, config, silent);
  if (handle.dialect === 'postgres') {
    await handle.db.execute(
      sql.raw(`truncate table ${DOMAIN_TABLES.join(', ')} restart identity cascade`),
    );
  }
  return buildDomainHarness(handle, 1024);
}
