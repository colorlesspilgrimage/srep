// Contract: process cache for deck, preset, and settings rows.
// The key is the Drizzle database object. Two handles do not share rows.
// A read copies the version, loads when the slot is empty, and stores
// only when that version is still current.
// Call dropCacheSlot on the next line after commit. Do not await between them.
// A failed write does not call dropCacheSlot.
// Do not call readCached inside an open write transaction.
// SQLite hits compare the database file and its -wal file.
// Postgres hits read xact_commit for current_database(). A change clears every slot.
import fs from 'node:fs';
import { sql } from 'drizzle-orm';

export type CacheSlot = 'decks' | 'presets' | 'study' | 'theme' | 'keybinds';

const SLOTS: readonly CacheSlot[] = ['decks', 'presets', 'study', 'theme', 'keybinds'];

type FileMark = { size: number; mtimeMs: number } | null;

type Stamp = { main: FileMark; wal: FileMark };

type Slot = {
  version: number;
  filled: boolean;
  value: unknown;
  stamp: Stamp | null;
};

type DbCache = {
  slots: Record<CacheSlot, Slot>;
  xact: string | null;
  flight: Promise<boolean> | null;
};

type PgRows = { length: number; [index: number]: Record<string, unknown> };

type ExecuteDb = {
  execute: (query: ReturnType<typeof sql>) => Promise<PgRows>;
};

const caches = new WeakMap<object, DbCache>();

function emptySlot(): Slot {
  return { version: 0, filled: false, value: undefined, stamp: null };
}

function emptyCache(): DbCache {
  const slots = {
    decks: emptySlot(),
    presets: emptySlot(),
    study: emptySlot(),
    theme: emptySlot(),
    keybinds: emptySlot(),
  };
  return { slots, xact: null, flight: null };
}

function cacheFor(db: object): DbCache {
  const found = caches.get(db);
  if (found !== undefined) {
    return found;
  }
  const created = emptyCache();
  caches.set(db, created);
  return created;
}

export function cacheSlotVersion(db: object, name: CacheSlot): number {
  return caches.get(db)?.slots[name].version ?? 0;
}

export function dropCacheSlot(db: object, name: CacheSlot): void {
  const slot = cacheFor(db).slots[name];
  slot.version += 1;
  slot.filled = false;
  slot.value = undefined;
  slot.stamp = null;
}

export function dropAllCache(db: object): void {
  for (const name of SLOTS) {
    dropCacheSlot(db, name);
  }
}

function clientOf(db: object): unknown {
  return (db as { $client?: unknown }).$client;
}

// better-sqlite3 sets $client to the file object. postgres.js sets $client to a
// function whose name is "sql". That name is not a database file.
function sqliteFile(db: object): string | null {
  const client = clientOf(db);
  if (typeof client !== 'object' || client === null) {
    return null;
  }
  const name = (client as { name?: unknown }).name;
  if (typeof name !== 'string' || name.length === 0 || name === ':memory:' || name.includes('\0')) {
    return null;
  }
  return name;
}

function markOf(file: string): FileMark {
  try {
    const stat = fs.statSync(file);
    return { size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

function fileStamp(db: object): Stamp | null {
  const file = sqliteFile(db);
  if (file === null) {
    return null;
  }
  return { main: markOf(file), wal: markOf(`${file}-wal`) };
}

function sameMark(left: FileMark, right: FileMark): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.size === right.size && left.mtimeMs === right.mtimeMs;
}

function sameStamp(left: Stamp, right: Stamp): boolean {
  return sameMark(left.main, right.main) && sameMark(left.wal, right.wal);
}

function stampChanged(slot: Slot, db: object): boolean {
  const current = fileStamp(db);
  if (current === null) {
    return false;
  }
  if (slot.stamp === null) {
    return true;
  }
  return !sameStamp(slot.stamp, current);
}

function isPostgres(db: object): db is ExecuteDb {
  const execute = (db as { execute?: unknown }).execute;
  return typeof clientOf(db) === 'function' && typeof execute === 'function';
}

async function readXact(db: ExecuteDb): Promise<string | null> {
  const rows = await db.execute(
    sql`select xact_commit from pg_stat_database where datname = current_database()`,
  );
  const value = rows[0]?.xact_commit;
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'bigint') {
    return String(value);
  }
  return null;
}

// This session does not see its own commits in xact_commit. Another session does.
// An equal value keeps the rows. A different value clears every slot.
async function readFresh(cache: DbCache, db: ExecuteDb): Promise<boolean> {
  const seen = await readXact(db);
  if (seen === null || cache.xact === null) {
    if (seen !== null) {
      cache.xact = seen;
    }
    return true;
  }
  const fresh = seen === cache.xact;
  cache.xact = seen;
  return fresh;
}

async function postgresFresh(cache: DbCache, db: object): Promise<boolean> {
  if (!isPostgres(db)) {
    return true;
  }
  if (cache.flight !== null) {
    return cache.flight;
  }
  const run = readFresh(cache, db);
  cache.flight = run;
  try {
    return await run;
  } finally {
    if (cache.flight === run) {
      cache.flight = null;
    }
  }
}

function clearSlots(cache: DbCache): void {
  for (const name of SLOTS) {
    const slot = cache.slots[name];
    slot.version += 1;
    slot.filled = false;
    slot.value = undefined;
    slot.stamp = null;
  }
}

function expose<T>(value: T): T {
  if (Array.isArray(value)) {
    return [...value] as T;
  }
  return value;
}

function invalidateStamp(slot: Slot, db: object): void {
  if (!slot.filled || !stampChanged(slot, db)) {
    return;
  }
  slot.version += 1;
  slot.filled = false;
  slot.value = undefined;
  slot.stamp = null;
}

export async function readCached<T>(
  db: object,
  name: CacheSlot,
  load: () => Promise<T>,
): Promise<T> {
  const cache = cacheFor(db);
  const slot = cache.slots[name];
  invalidateStamp(slot, db);
  if (slot.filled && !(await postgresFresh(cache, db))) {
    clearSlots(cache);
  }
  if (slot.filled) {
    return expose(slot.value as T);
  }
  const version = slot.version;
  const value = await load();
  const stamp = fileStamp(db);
  const xact = isPostgres(db) ? await readXact(db) : null;
  if (slot.version === version) {
    slot.value = value;
    slot.filled = true;
    slot.stamp = stamp;
    if (xact !== null) {
      cache.xact = xact;
    }
  }
  return expose(value);
}
