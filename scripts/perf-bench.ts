// Contract: time study next, answer, deck list, note read, and gallery settings.
// Input: CLI flags and SREP_DATABASE_URL. Output: median and p95 lines.
// The clock is frozen. Warmup calls are dropped. Values are not shell text.
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import postgres from 'postgres';
import { parseConfig } from '#lib/server/config.js';
import { createDb, type DbHandle } from '#lib/server/db/client.js';
import { runMigrations } from '#lib/server/db/migrate.js';
import type { DomainDeps } from '#lib/server/domain/deps.js';
import { listDecks } from '#lib/server/domain/decks.js';
import { getNote } from '#lib/server/domain/notes.js';
import { seedDomain } from '#lib/server/domain/seed.js';
import { getDomainStore } from '#lib/server/domain/store/store.js';
import { readGallerySettings } from '#lib/server/settings/gallery-settings-read.js';
import { seededRandom } from '#lib/server/auth/test-support/harness.js';
import type { StudyDeps } from '#lib/server/study/deps.js';
import { answer } from '#lib/server/study/study-answer.js';
import { getNext } from '#lib/server/study/study-next.js';
import { getStudyStore } from '#lib/server/study/store/store.js';
import { DEFAULT_STUDY_SETTINGS, type StudyWindow } from '#lib/server/study/core/types.js';
import { studyWindow } from '#lib/server/study/core/day-clock.js';
import { median, p95 } from './perf-bench-stats.js';
import { seedBench, type SeedResult } from './perf-bench-seed.js';

export const BENCH_NOW_MS = 1_791_984_641_914;
export const DEFAULT_BENCH_URL = 'sqlite:/tmp/srep-perf.db';

const FLAG_NAMES = ['--decks', '--notes-per-deck', '--warmup', '--runs'] as const;
type FlagName = (typeof FLAG_NAMES)[number];
const FLAG_VALUE = /^[1-9][0-9]{0,4}$/;

export type BenchArgs = { decks: number; notesPerDeck: number; warmup: number; runs: number };

type Counter = { statements: number; app: number };

type Timed = { samples: number[]; statements: number; app: number };

const silent = { info() {} };

export function benchDatabaseUrl(env: Record<string, string | undefined>): string {
  const raw = env.SREP_DATABASE_URL;
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_BENCH_URL;
  }
  return raw.trim();
}

export function isPostgresUrl(url: string): boolean {
  return url.startsWith('postgres://') || url.startsWith('postgresql://');
}

function isFlag(token: string): token is FlagName {
  return (FLAG_NAMES as readonly string[]).includes(token);
}

function assign(args: BenchArgs, name: FlagName, value: number): void {
  if (name === '--decks') {
    args.decks = value;
  } else if (name === '--notes-per-deck') {
    args.notesPerDeck = value;
  } else if (name === '--warmup') {
    args.warmup = value;
  } else {
    args.runs = value;
  }
}

export function parseBenchArgs(argv: readonly string[]): BenchArgs | { error: string } {
  const args: BenchArgs = { decks: 20, notesPerDeck: 500, warmup: 5, runs: 30 };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? '';
    const pair = /^(--[a-z-]+)=(.*)$/.exec(token);
    if (pair !== null) {
      const name = pair[1] ?? '';
      const raw = pair[2] ?? '';
      if (!isFlag(name) || !FLAG_VALUE.test(raw)) {
        return { error: `bad argument ${token}` };
      }
      assign(args, name, Number(raw));
      continue;
    }
    if (!isFlag(token)) {
      return { error: `bad argument ${token}` };
    }
    const raw = argv[index + 1] ?? '';
    if (!FLAG_VALUE.test(raw)) {
      return { error: `bad argument ${token}` };
    }
    assign(args, token, Number(raw));
    index += 1;
  }
  return args;
}

export function noteDriverQuery(counter: Counter, query: string): void {
  counter.statements += 1;
  const text = query.trim().toLowerCase();
  if (/^(select|insert|update|delete)\b/.test(text)) {
    counter.app += 1;
  }
}

function attachSqliteCounter(db: BetterSQLite3Database, counter: Counter): void {
  const sqlite = db.$client;
  const original = sqlite.prepare.bind(sqlite);
  sqlite.prepare = (source: string) => {
    const stmt = original(source);
    for (const method of ['get', 'all', 'run', 'iterate'] as const) {
      const fn = stmt[method] as (...args: unknown[]) => unknown;
      stmt[method] = (...args: unknown[]) => {
        const text = source.trim().toLowerCase();
        if (/^(select|insert|update|delete|with)\b/.test(text)) {
          noteDriverQuery(counter, source);
        }
        return fn.apply(stmt, args);
      };
    }
    return stmt;
  };
}

function removeSqliteFiles(file: string): void {
  if (file === ':memory:') {
    return;
  }
  fs.rmSync(file, { force: true });
  fs.rmSync(`${file}-wal`, { force: true });
  fs.rmSync(`${file}-shm`, { force: true });
}

function openPostgres(url: string, counter: Counter): DbHandle {
  const client = postgres(url, {
    max: 5,
    onnotice: () => {},
    debug: (_connection, query) => {
      noteDriverQuery(counter, String(query));
    },
  });
  const db = drizzlePostgres(client);
  return {
    dialect: 'postgres',
    db,
    async ping() {
      await client`select 1`;
    },
    async close() {
      await client.end({ timeout: 5 });
    },
  };
}

async function timeSet(
  counter: Counter,
  warmup: number,
  runs: number,
  fn: () => Promise<void>,
): Promise<Timed> {
  for (let index = 0; index < warmup; index += 1) {
    await fn();
  }
  const samples: number[] = [];
  let statements = 0;
  let app = 0;
  for (let index = 0; index < runs; index += 1) {
    const startStatements = counter.statements;
    const startApp = counter.app;
    const start = performance.now();
    await fn();
    samples.push(performance.now() - start);
    statements = counter.statements - startStatements;
    app = counter.app - startApp;
  }
  return { samples, statements, app };
}

function formatLine(label: string, timed: Timed, postgres: boolean): string {
  const count = postgres
    ? `driver ${timed.statements} app ${timed.app}`
    : `statements ${timed.statements}`;
  const mid = median(timed.samples).toFixed(2);
  const tail = p95(timed.samples).toFixed(2);
  return `${label}: ${count}, median ${mid} ms, p95 ${tail} ms`;
}

function answerJob(study: StudyDeps, seeded: SeedResult): () => Promise<void> {
  let answerIndex = 0;
  return async () => {
    const cardId = seeded.newCardIds[answerIndex] ?? seeded.newCardIds[0];
    answerIndex += 1;
    if (cardId === undefined) {
      throw new Error('no new card');
    }
    const result = await answer(study, { cardId, rating: 3, reps: 0, elapsedMs: 1000 });
    if (!result.ok) {
      throw new Error(result.error);
    }
  };
}

async function runJob(
  label: string,
  counter: Counter,
  args: BenchArgs,
  postgres: boolean,
  fn: () => Promise<void>,
) {
  const timed = await timeSet(counter, args.warmup, args.runs, fn);
  console.log(formatLine(label, timed, postgres));
}

async function measure(
  handle: DbHandle,
  study: StudyDeps,
  domain: DomainDeps,
  seeded: SeedResult,
  args: BenchArgs,
  counter: Counter,
  postgres: boolean,
): Promise<void> {
  counter.statements = 0;
  counter.app = 0;
  if (handle.dialect === 'sqlite') {
    attachSqliteCounter(handle.db, counter);
  }
  const deckId = seeded.deckIds[0] ?? '';
  const noteId = seeded.noteIds[0] ?? '';
  await runJob('getNext all decks', counter, args, postgres, async () => {
    const result = await getNext(study, {});
    if (!result.ok) {
      throw new Error(result.error);
    }
  });
  await runJob('getNext one deck', counter, args, postgres, async () => {
    const result = await getNext(study, { deckId });
    if (!result.ok) {
      throw new Error(result.error);
    }
  });
  await runJob('answer', counter, args, postgres, answerJob(study, seeded));
  await runJob('listDecks', counter, args, postgres, async () => {
    await listDecks(domain);
  });
  await runJob('getNote', counter, args, postgres, async () => {
    const result = await getNote(domain, noteId);
    if (!result.ok) {
      throw new Error(result.error);
    }
  });
  await runJob('gallery settings', counter, args, postgres, async () => {
    const result = await readGallerySettings(handle, null);
    if (!result.ok) {
      throw new Error(result.error);
    }
  });
}

async function prepare(
  handle: DbHandle,
  args: BenchArgs,
  window: StudyWindow,
): Promise<{ study: StudyDeps; domain: DomainDeps; seeded: SeedResult }> {
  const store = getDomainStore(handle);
  const domain: DomainDeps = {
    store,
    media: {
      async write() {},
      async read() {
        return null;
      },
    },
    now: () => BENCH_NOW_MS,
    random: seededRandom(),
    limits: { mediaMaxBytes: 1024 },
  };
  await seedDomain(domain);
  const seeded = await seedBench(handle, args.decks, args.notesPerDeck, BENCH_NOW_MS, window);
  const study: StudyDeps = {
    store: getStudyStore(handle),
    domain: store,
    now: () => BENCH_NOW_MS,
    random: seededRandom(),
    logger: { error() {} },
  };
  return { study, domain, seeded };
}

function printHeader(seeded: SeedResult, args: BenchArgs): void {
  console.log(
    'method: service calls on getNext, answer, listDecks, getNote, and readGallerySettings',
  );
  console.log('method: sqlite logger wraps prepare get, all, run, and iterate');
  console.log('method: postgres logger is the driver debug callback');
  console.log('method: median is the mean of the two middle sorted values');
  console.log(
    `data size: ${seeded.decks} decks, ${seeded.notes} notes, ${seeded.cards} cards, ${seeded.reviewLogs} review_log rows`,
  );
  console.log(`run count: warmup ${args.warmup}, runs ${args.runs}`);
  console.log(`clock: ${BENCH_NOW_MS}`);
}

export async function runBench(
  argv: readonly string[],
  env: Record<string, string | undefined> = process.env,
): Promise<number> {
  const parsed = parseBenchArgs(argv);
  if ('error' in parsed) {
    console.error(parsed.error);
    return 1;
  }
  const url = benchDatabaseUrl(env);
  const postgres = isPostgresUrl(url);
  let handle: DbHandle | undefined;
  try {
    const config = parseConfig({ SREP_DATABASE_URL: url });
    const counter: Counter = { statements: 0, app: 0 };
    if (config.database.dialect === 'sqlite') {
      removeSqliteFiles(config.database.path);
      handle = createDb(config);
    } else {
      handle = openPostgres(url, counter);
    }
    await runMigrations(handle, config, silent);
    const window = studyWindow(BENCH_NOW_MS, DEFAULT_STUDY_SETTINGS);
    const ready = await prepare(handle, parsed, window);
    printHeader(ready.seeded, parsed);
    if (handle.dialect === 'postgres') {
      console.log('sqlite UNMEASURED: SREP_DATABASE_URL starts with postgres://');
    }
    await measure(handle, ready.study, ready.domain, ready.seeded, parsed, counter, postgres);
    if (!postgres) {
      console.log('postgres UNMEASURED: SREP_DATABASE_URL does not start with postgres://');
    }
    return 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'bench failed';
    console.error(message);
    return 1;
  } finally {
    await handle?.close();
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  runBench(process.argv.slice(2)).then((code) => {
    process.exit(code);
  });
}
