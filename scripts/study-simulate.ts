// Runs the study simulation with a fake clock and prints JSON lines.
// Usage: npm run study:simulate [-- --days N] (N is 1..3650, default 365).
// Database: always a fresh in-memory SQLite database. The script ignores SREP_DATABASE_URL,
// because it adds decks and notes, changes the study settings and undoes reviews (CWE-1188).
// Exit codes: 0 all counters are 0, 1 a counter is not 0 or a step failed, 2 bad arguments.
import type { Config } from '../src/lib/server/config.ts';
import { parseConfig } from '../src/lib/server/config.ts';
import { createDb, type DbHandle } from '../src/lib/server/db/client.ts';
import { runMigrations } from '../src/lib/server/db/migrate.ts';
import type { DomainDeps } from '../src/lib/server/domain/deps.ts';
import { createFsMediaFiles } from '../src/lib/server/domain/media-files.fs.ts';
import { getDomainStore } from '../src/lib/server/domain/store/store.ts';
import type { StudyDeps } from '../src/lib/server/study/deps.ts';
import { getStudyStore } from '../src/lib/server/study/store/store.ts';
import { runSimulation } from '../src/lib/server/study/test-support/simulation.ts';
import { seededBytes } from '../src/lib/server/study/test-support/simulation-checks.ts';

const EXIT_USAGE = 2;
const USAGE = 'Usage: npm run study:simulate [-- --days N]  (N is an integer from 1 to 3650)';
const SEED = 20260101;

// Returns the day count, or null for bad arguments.
function parseDays(args: string[]): number | null {
  if (args.length === 0) {
    return 365;
  }
  if (args.length !== 2 || args[0] !== '--days' || !/^\d{1,4}$/.test(args[1] ?? '')) {
    return null;
  }
  const days = Number(args[1]);
  return days >= 1 && days <= 3650 ? days : null;
}

async function simulate(db: DbHandle, config: Config, days: number): Promise<number> {
  await runMigrations(db, config, { info: () => undefined });
  const clock = { now: 0 };
  const domain: DomainDeps = {
    store: getDomainStore(db),
    media: createFsMediaFiles(config.media.dir),
    now: () => clock.now,
    random: seededBytes(SEED),
    limits: { mediaMaxBytes: config.media.maxBytes },
  };
  const study: StudyDeps = {
    store: getStudyStore(db),
    domain: domain.store,
    now: () => clock.now,
    random: seededBytes(SEED + 1),
    logger: { error: (obj, msg) => console.error(JSON.stringify({ msg, ...obj })) },
  };
  const result = await runSimulation(
    { study, domain, handle: db, clock },
    { days, seed: SEED, onProgress: (line) => console.log(JSON.stringify(line)) },
  );
  const { limitViolations, replayMismatches, undoMismatches, reviews } = result;
  console.log(JSON.stringify({ days, reviews, limitViolations, replayMismatches, undoMismatches }));
  return limitViolations + replayMismatches + undoMismatches === 0 ? 0 : 1;
}

async function main(): Promise<number> {
  const days = parseDays(process.argv.slice(2));
  if (days === null) {
    console.error(USAGE);
    return EXIT_USAGE;
  }
  let db: DbHandle | undefined;
  try {
    const config = parseConfig({ SREP_DATABASE_URL: 'sqlite::memory:' });
    db = createDb(config);
    return await simulate(db, config, days);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : 'study simulation failed');
    return 1;
  } finally {
    await db?.close().catch(() => undefined);
  }
}

process.exitCode = await main();
