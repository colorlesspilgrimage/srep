import crypto from 'node:crypto';
import type { Result } from '../src/lib/server/auth/deps.ts';
import { getConfig } from '../src/lib/server/config.ts';
import { createDb, type DbHandle } from '../src/lib/server/db/client.ts';
import { runMigrations } from '../src/lib/server/db/migrate.ts';
import { BASIC_ID, BASIC_REVERSED_ID, CLOZE_ID } from '../src/lib/server/domain/builtin.ts';
import { createDeck, listDecks, updateDeck } from '../src/lib/server/domain/decks.ts';
import type { DomainDeps } from '../src/lib/server/domain/deps.ts';
import { createFsMediaFiles } from '../src/lib/server/domain/media-files.fs.ts';
import { createNote } from '../src/lib/server/domain/notes.ts';
import { seedDomain } from '../src/lib/server/domain/seed.ts';
import { getDomainStore } from '../src/lib/server/domain/store/store.ts';

const EXIT_USAGE = 2;
const USAGE = 'Usage: npm run domain:demo [-- --unique]';

type Line = Record<string, unknown>;

function must<T extends object>(result: Result<T>): { ok: true } & T {
  if (!result.ok) {
    throw new Error(`demo step failed: ${result.error}`);
  }
  return result;
}

const NOTES: { type: string; noteTypeId: string; fields: string[]; tags: string[] }[] = [
  { type: 'Basic', noteTypeId: BASIC_ID, fields: ['犬', 'dog'], tags: ['animals'] },
  {
    type: 'Basic+Reversed',
    noteTypeId: BASIC_REVERSED_ID,
    fields: ['犬', 'dog'],
    tags: ['animals'],
  },
  {
    type: 'Cloze',
    noteTypeId: CLOZE_ID,
    fields: ['{{c1::Tokyo}} is the capital of {{c2::Japan}}', ''],
    tags: ['geography'],
  },
];

// Creates two decks and three notes, then renames the top deck. Returns one line per step.
async function runDemo(deps: DomainDeps, suffix: string): Promise<Line[]> {
  const lines: Line[] = [];
  const top = must(await createDeck(deps, { name: `Languages${suffix}` })).deck;
  const child = must(await createDeck(deps, { name: 'Japanese', parentId: top.id })).deck;
  lines.push({ step: 'deck', path: top.path }, { step: 'deck', path: child.path });
  for (const note of NOTES) {
    const input = {
      noteTypeId: note.noteTypeId,
      deckId: child.id,
      fields: note.fields,
      tags: note.tags,
    };
    const { cards } = must(await createNote(deps, input)).note;
    lines.push({
      step: 'note',
      type: note.type,
      cards: cards.length,
      fronts: cards.map((c) => c.front),
    });
  }
  must(await updateDeck(deps, top.id, { name: `Lang${suffix}` }));
  const decks = must(await listDecks(deps)).decks;
  const paths = decks.filter((d) => d.id === top.id || d.id === child.id).map((d) => d.path);
  lines.push({ step: 'rename', paths });
  return lines;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--unique')) {
    console.error(USAGE);
    return EXIT_USAGE;
  }
  // A suffix keeps repeated runs on one database apart. It is used only with --unique.
  const suffix = args.includes('--unique') ? `-${Date.now()}` : '';
  let db: DbHandle | undefined;
  try {
    const config = getConfig();
    db = createDb(config);
    await runMigrations(db, config, { info: () => undefined });
    const deps: DomainDeps = {
      store: getDomainStore(db),
      media: createFsMediaFiles(config.media.dir),
      now: Date.now,
      random: crypto.randomBytes,
      limits: { mediaMaxBytes: config.media.maxBytes },
    };
    await seedDomain(deps);
    for (const line of await runDemo(deps, suffix)) {
      console.log(JSON.stringify(line));
    }
    return 0;
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : 'domain demo failed');
    return 1;
  } finally {
    await db?.close().catch(() => undefined);
  }
}

process.exitCode = await main();
