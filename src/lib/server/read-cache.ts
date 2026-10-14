// Contract: process cache for deck, preset, and settings rows.
// The key is the Drizzle database object. Two handles do not share rows.
// A stored row is a clone. A caller cannot change the stored row.
// Call dropCacheSlot on the next line after commit. Do not await between them.
// A failed write does not call dropCacheSlot.
// Do not call readCached inside an open write transaction.
// A missing xact_commit does not count as fresh.
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

function clearSlot(slot: Slot): void {
  slot.version += 1;
  slot.filled = false;
  slot.value = undefined;
  slot.stamp = null;
}

export function dropCacheSlot(db: object, name: CacheSlot): void {
  clearSlot(cacheFor(db).slots[name]);
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
// A missing value is not fresh (CWE-345).
async function readFresh(cache: DbCache, db: ExecuteDb): Promise<boolean> {
  const seen = await readXact(db);
  if (seen === null || cache.xact === null) {
    return false;
  }
  return seen === cache.xact;
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
    clearSlot(cache.slots[name]);
  }
}

function isolate<T>(value: T): { ok: true; value: T } | { ok: false } {
  if (typeof value !== 'object' || value === null) {
    return { ok: true, value };
  }
  try {
    return { ok: true, value: structuredClone(value) };
  } catch {
    return { ok: false };
  }
}

function hitValue<T>(value: T): T {
  const hit = isolate(value);
  return hit.ok ? hit.value : value;
}

function stampsStable(before: Stamp | null, after: Stamp | null): boolean {
  if (before === null || after === null) {
    return before === after;
  }
  return sameStamp(before, after);
}

function canStore(
  db: object,
  version: number,
  slot: Slot,
  stampBefore: Stamp | null,
  stampAfter: Stamp | null,
  xactBefore: string | null,
  xactAfter: string | null,
): boolean {
  if (slot.version !== version || !stampsStable(stampBefore, stampAfter)) {
    return false;
  }
  if (!isPostgres(db)) {
    return true;
  }
  return xactAfter !== null && xactBefore === xactAfter;
}

function invalidateStamp(slot: Slot, db: object): void {
  if (!slot.filled || !stampChanged(slot, db)) {
    return;
  }
  clearSlot(slot);
}

async function prepareSlot(cache: DbCache, slot: Slot, db: object): Promise<void> {
  invalidateStamp(slot, db);
  if (slot.filled && !(await postgresFresh(cache, db))) {
    clearSlots(cache);
  }
}

async function fillSlot<T>(
  cache: DbCache,
  slot: Slot,
  db: object,
  load: () => Promise<T>,
): Promise<T> {
  const version = slot.version;
  const stampBefore = fileStamp(db);
  const xactBefore = isPostgres(db) ? await readXact(db) : null;
  const value = await load();
  const stampAfter = fileStamp(db);
  const xactAfter = isPostgres(db) ? await readXact(db) : null;
  const copy = isolate(value);
  const store = canStore(db, version, slot, stampBefore, stampAfter, xactBefore, xactAfter);
  if (copy.ok && store) {
    slot.value = copy.value;
    slot.filled = true;
    slot.stamp = stampAfter;
    if (xactAfter !== null) {
      cache.xact = xactAfter;
    }
    return hitValue(slot.value as T);
  }
  return copy.ok ? copy.value : value;
}

export async function readCached<T>(
  db: object,
  name: CacheSlot,
  load: () => Promise<T>,
): Promise<T> {
  const cache = cacheFor(db);
  const slot = cache.slots[name];
  await prepareSlot(cache, slot, db);
  if (slot.filled) {
    return hitValue(slot.value as T);
  }
  return fillSlot(cache, slot, db, load);
}
