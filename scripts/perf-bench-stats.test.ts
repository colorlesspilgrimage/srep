import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PRESET_ID } from '#lib/server/domain/builtin.js';
import type { DbHandle } from '#lib/server/db/client.js';
import type { SQL } from 'drizzle-orm';
import { studyWindow } from '#lib/server/study/core/day-clock.js';
import { DEFAULT_STUDY_SETTINGS } from '#lib/server/study/core/types.js';
import {
  BENCH_NOW_MS,
  benchDatabaseUrl,
  benchLogger,
  benchMedia,
  benchSqlitePathAllowed,
  isPostgresUrl,
  noteDriverQuery,
  parseBenchArgs,
  runBench,
} from './perf-bench.js';
import { buildSeed, deckInsertSql, seedBench, splitNotes } from './perf-bench-seed.js';
import { median, p95 } from './perf-bench-stats.js';

const files: string[] = [];

afterEach(() => {
  for (const file of files.splice(0)) {
    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}-wal`, { force: true });
    fs.rmSync(`${file}-shm`, { force: true });
  }
});

describe('bench stats', () => {
  it('uses the mean of the two middle values and p95 index 28', () => {
    expect(median([1, 3])).toBe(2);
    expect(median([4])).toBe(4);
    const samples = Array.from({ length: 30 }, (_, index) => index + 1);
    expect(p95(samples)).toBe(29);
    expect(median(samples)).toBe(15.5);
  });

  it('rejects bad flags and binds the deck name', () => {
    expect(parseBenchArgs(['--decks=0'])).toEqual({ error: 'bad argument --decks=0' });
    expect(parseBenchArgs(['--decks', '-1'])).toEqual({ error: 'bad argument --decks' });
    expect(parseBenchArgs(['--decks=abc'])).toEqual({ error: 'bad argument --decks=abc' });
    expect(parseBenchArgs(['--nope'])).toEqual({ error: 'bad argument --nope' });
    expect(parseBenchArgs(['--decks', '2', '--notes-per-deck=3'])).toMatchObject({
      decks: 2,
      notesPerDeck: 3,
      warmup: 5,
      runs: 30,
    });
    const compiled = new SQLiteSyncDialect().sqlToQuery(
      deckInsertSql('d0', 'Deck1', DEFAULT_PRESET_ID),
    );
    expect(compiled.sql.includes('Deck1')).toBe(false);
    expect(compiled.params).toContain('Deck1');
    expect(
      buildSeed(20, 500, BENCH_NOW_MS, studyWindow(BENCH_NOW_MS, DEFAULT_STUDY_SETTINGS)).result
        .reviewLogs,
    ).toBe(8436);
    expect(splitNotes(20)).toMatchObject({
      fresh: 8,
      dueReview: 8,
      learning: 2,
      future: 1,
      buried: 1,
    });
  });

  it('uses the default sqlite url and counts only data statements', () => {
    expect(benchDatabaseUrl({})).toBe('sqlite:/tmp/srep-perf.db');
    expect(benchDatabaseUrl({ SREP_DATABASE_URL: '  ' })).toBe('sqlite:/tmp/srep-perf.db');
    expect(isPostgresUrl('postgres://localhost/srep')).toBe(true);
    expect(isPostgresUrl('postgresql://localhost/srep')).toBe(true);
    const counter = { statements: 0, app: 0 };
    noteDriverQuery(counter, 'select 1');
    noteDriverQuery(counter, 'begin');
    expect(counter).toEqual({ statements: 2, app: 1 });
  });

  it('returns 1 for a bad flag and seeds postgres with bound sql', async () => {
    expect(await runBench(['--decks=0'])).toBe(1);
    const executed: SQL[] = [];
    const handle = {
      dialect: 'postgres',
      db: {
        transaction: async (
          fn: (tx: { execute: (query: SQL) => Promise<void> }) => Promise<void>,
        ) => {
          await fn({
            async execute(query) {
              executed.push(query);
            },
          });
        },
      },
      async ping() {},
      async close() {},
    } as unknown as DbHandle;
    const window = studyWindow(BENCH_NOW_MS, DEFAULT_STUDY_SETTINGS);
    const seeded = await seedBench(handle, 1, 1, BENCH_NOW_MS, window);
    expect(seeded.cards).toBe(1);
    expect(executed.length).toBeGreaterThan(0);
  });

  it('runs the silent helpers and a memory bench', async () => {
    expect(await benchMedia().read('x')).toBeNull();
    await benchMedia().write('x', Buffer.alloc(0));
    benchLogger().error({ key: 'study' }, 'quiet');
    expect(
      await runBench(['--decks', '1', '--notes-per-deck', '5', '--warmup', '1', '--runs', '1'], {
        SREP_DATABASE_URL: 'sqlite::memory:',
      }),
    ).toBe(0);
  });

  it('does not delete a sqlite file outside the temp directory', async () => {
    const file = path.join(process.cwd(), `srep-bench-guard-${process.pid}.db`);
    const outside = path.join(process.cwd(), `srep-bench-real-${process.pid}.db`);
    fs.writeFileSync(file, 'keep');
    fs.writeFileSync(outside, 'keep');
    files.push(file, outside);
    const link = path.join(os.tmpdir(), `srep-bench-link-${process.pid}.db`);
    fs.symlinkSync(outside, link);
    files.push(link);
    expect(benchSqlitePathAllowed(file)).toBe(false);
    expect(benchSqlitePathAllowed(link)).toBe(false);
    expect(benchSqlitePathAllowed(':memory:')).toBe(true);
    const code = await runBench(['--decks', '1'], { SREP_DATABASE_URL: `sqlite:${file}` });
    expect(code).toBe(1);
    expect(fs.readFileSync(file, 'utf8')).toBe('keep');
    expect(fs.readFileSync(outside, 'utf8')).toBe('keep');
  });

  it('returns 1 when postgres cannot be reached', async () => {
    expect(
      await runBench(['--decks', '1', '--notes-per-deck', '1', '--warmup', '1', '--runs', '1'], {
        SREP_DATABASE_URL: 'postgres://127.0.0.1:1/srep',
      }),
    ).toBe(1);
  });

  it('runs a one-deck sqlite bench', async () => {
    const file = path.join(os.tmpdir(), `srep-bench-${process.pid}.db`);
    files.push(file);
    const code = await runBench(
      ['--decks', '1', '--notes-per-deck', '20', '--warmup', '1', '--runs', '1'],
      { SREP_DATABASE_URL: `sqlite:${file}` },
    );
    expect(code).toBe(0);
  });
});
