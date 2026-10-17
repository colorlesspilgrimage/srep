// Contract: two SQLite connections write at the same time (CWE-362).
// The second bulk call must wait for the first commit, then read that row.
// A deferred transaction fails at once with "database is locked".

import { createRequire } from 'node:module';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import { seededRandom } from '#lib/server/auth/test-support/harness.js';
import { parseConfig } from '#lib/server/config.js';
import { createDb, type DbHandle } from '#lib/server/db/client.js';
import { runMigrations } from '#lib/server/db/migrate.js';
import { BASIC_ID } from '#lib/server/domain/builtin.js';
import { createDeck } from '#lib/server/domain/decks.js';
import type { DomainDeps } from '#lib/server/domain/deps.js';
import { createFsMediaFiles } from '#lib/server/domain/media-files.fs.js';
import { createNote } from '#lib/server/domain/notes.js';
import { seedDomain } from '#lib/server/domain/seed.js';
import { replaceNoteTags, trashNotes } from '#lib/server/domain/store/note-bulk.sqlite.js';
import { getDomainStore } from '#lib/server/domain/store/store.js';
import { makeTempDir, removeTempDirs } from '#lib/server/temp-dir.js';

const require = createRequire(import.meta.url);
const sqliteEntry = require.resolve('better-sqlite3');

type Opened = { handle: DbHandle; deps: DomainDeps; dirs: string[]; file: string };

async function openFile(): Promise<Opened> {
  const dirs: string[] = [];
  const dir = makeTempDir(dirs);
  const file = path.join(dir, 'race.db');
  const config = parseConfig({ SREP_DATABASE_URL: `sqlite:${file}` });
  const handle = createDb(config);
  await runMigrations(handle, config, { info() {} });
  const store = getDomainStore(handle);
  const deps: DomainDeps = {
    store,
    media: createFsMediaFiles(dir),
    now: () => 1_000,
    random: seededRandom(),
    limits: { mediaMaxBytes: 1024 },
  };
  await seedDomain(deps);
  return { handle, deps, dirs, file };
}

function hold(file: string, statement: string, id: string): Promise<Worker> {
  const source = `
    import { parentPort, workerData } from 'node:worker_threads';
    import Database from ${JSON.stringify(sqliteEntry)};
    const db = new Database(workerData.file);
    db.pragma('busy_timeout = 5000');
    db.exec('BEGIN IMMEDIATE');
    db.prepare(workerData.statement).run(workerData.id);
    parentPort.postMessage('locked');
    await new Promise((resolve) => setTimeout(resolve, 400));
    db.exec('COMMIT');
    db.close();
    parentPort.postMessage('committed');
  `;
  const worker = new Worker(source, { eval: true, workerData: { file, statement, id } });
  return new Promise((resolve, reject) => {
    worker.once('message', (message) => {
      if (message === 'locked') resolve(worker);
      else reject(new Error(String(message)));
    });
    worker.once('error', reject);
  });
}

async function makeNote(deps: DomainDeps): Promise<string> {
  const deck = await createDeck(deps, { name: 'Spanish' });
  if (!deck.ok) throw new Error(deck.error);
  const note = await createNote(deps, {
    noteTypeId: BASIC_ID,
    deckId: deck.deck.id,
    fields: ['gato', 'cat'],
    tags: ['animals'],
  });
  if (!note.ok) throw new Error(note.error);
  return note.note.id;
}

describe('sqlite bulk writes from two connections', () => {
  const dirs: string[] = [];
  let handle: DbHandle | undefined;

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
    removeTempDirs(dirs);
  });

  it('adds a tag after the other write commits', async () => {
    const opened = await openFile();
    handle = opened.handle;
    dirs.push(...opened.dirs);
    const id = await makeNote(opened.deps);
    if (handle.dialect !== 'sqlite') throw new Error('sqlite');
    const worker = await hold(
      opened.file,
      `update note_tag set tag = 'plants' where note_id = ?`,
      id,
    );
    try {
      expect(replaceNoteTags(handle.db, [id], ['extra'], [], 50)).toBe('ok');
      expect((await opened.deps.store.getNoteState(id))?.tags).toEqual(['extra', 'plants']);
    } finally {
      await worker.terminate();
    }
  });

  it('sees a delete that commits first', async () => {
    const opened = await openFile();
    handle = opened.handle;
    dirs.push(...opened.dirs);
    const id = await makeNote(opened.deps);
    if (handle.dialect !== 'sqlite') throw new Error('sqlite');
    const statement = `update note set deleted_at = 7, updated_at = 7 where id = ?`;
    const worker = await hold(opened.file, statement, id);
    try {
      expect(trashNotes(handle.db, [id], 80)).toBe('not_found');
      expect((await opened.deps.store.getNoteState(id))?.note.deletedAt).toBe(7);
    } finally {
      await worker.terminate();
    }
  });
});
