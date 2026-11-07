import { strToU8, zipSync } from 'fflate';
import Database from 'better-sqlite3';
import type { ImportExportDeps } from '#lib/server/import-export/deps.js';
import { referencedMediaShas } from '#lib/server/import-export/collect-media.js';

function notesInDeck(
  manifest: Awaited<ReturnType<ImportExportDeps['snapshot']['readSnapshot']>>,
  deckId: string | undefined,
): { noteIds: Set<string> } {
  const cardRows =
    deckId === undefined ? manifest.cards : manifest.cards.filter((card) => card.deckId === deckId);
  return { noteIds: new Set(cardRows.map((card) => card.noteId)) };
}

export async function exportCsv(
  deps: ImportExportDeps,
  format: 'csv' | 'tsv',
  deckId: string | undefined,
): Promise<Buffer> {
  const manifest = await deps.snapshot.readSnapshot(deps.now());
  const { noteIds } = notesInDeck(manifest, deckId);
  const sep = format === 'tsv' ? '\t' : ',';
  const lines = ['deck,front,back,tags'];
  for (const note of manifest.notes) {
    if (note.deletedAt !== null || !noteIds.has(note.id)) {
      continue;
    }
    const card = manifest.cards.find((row) => row.noteId === note.id);
    const deck = manifest.decks.find((row) => row.id === card?.deckId);
    const tags = manifest.noteTags
      .filter((row) => row.noteId === note.id)
      .map((row) => row.tag)
      .join(' ');
    const front = note.fields[0] ?? '';
    const back = note.fields[1] ?? '';
    const esc = (value: string): string =>
      value.includes(sep) || value.includes('"') || value.includes('\n')
        ? `"${value.replaceAll('"', '""')}"`
        : value;
    lines.push([deck?.path ?? 'Default', esc(front), esc(back), esc(tags)].join(sep));
  }
  return Buffer.from(lines.join('\n'), 'utf8');
}

export async function exportText(
  deps: ImportExportDeps,
  deckId: string | undefined,
): Promise<Buffer> {
  const manifest = await deps.snapshot.readSnapshot(deps.now());
  const { noteIds } = notesInDeck(manifest, deckId);
  const parts: string[] = [];
  for (const note of manifest.notes) {
    if (note.deletedAt !== null || !noteIds.has(note.id)) {
      continue;
    }
    parts.push(note.fields[0] ?? '');
    parts.push(note.fields[1] ?? '');
    parts.push('---');
  }
  return Buffer.from(parts.join('\n'), 'utf8');
}

export async function exportApkg(
  deps: ImportExportDeps,
  deckId: string | undefined,
): Promise<Buffer> {
  const manifest = await deps.snapshot.readSnapshot(deps.now());
  const { noteIds } = notesInDeck(manifest, deckId);
  const now = Math.floor(deps.now() / 1000);
  const db = new Database(':memory:');
  db.exec(`
    create table col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null);
    create table notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
    create table cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
  `);

  const deckJson: Record<string, { id: number; name: string; usn: number; mod: number }> = {
    '1': { id: 1, name: 'Imported', usn: 0, mod: now },
  };
  const modelJson = {
    '1': {
      id: 1,
      name: 'Basic',
      type: 0,
      flds: [
        { name: 'Front', ord: 0 },
        { name: 'Back', ord: 1 },
      ],
      tmpls: [
        {
          name: 'Card 1',
          ord: 0,
          qfmt: '{{Front}}',
          afmt: '{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}',
        },
      ],
      css: '.card{font-family:arial;}',
    },
  };

  db.prepare(
    'insert into col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags) values (1, ?, ?, 0, 11, 0, 0, 0, ?, ?, ?, ?, ?)',
  ).run(now, now, '{}', JSON.stringify(modelJson), JSON.stringify(deckJson), '{}', '{}');

  const shas = referencedMediaShas(manifest);
  const mediaMap: Record<string, string> = {};
  const zipEntries: Record<string, Uint8Array> = {};
  let mediaIndex = 0;

  let noteNum = 1;
  let cardNum = 1;
  for (const note of manifest.notes) {
    if (note.deletedAt !== null || !noteIds.has(note.id)) {
      continue;
    }
    const tags = manifest.noteTags
      .filter((row) => row.noteId === note.id)
      .map((row) => row.tag)
      .join(' ');
    const flds = note.fields.join('\u001f');
    db.prepare(
      'insert into notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data) values (?, ?, 1, ?, 0, ?, ?, 0, 0, 0, "")',
    ).run(noteNum, note.guid, now, tags, flds);
    db.prepare(
      'insert into cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data) values (?, ?, 1, 0, ?, 0, 2, 2, ?, 1, 2500, 0, 0, 0, 0, 0, 0, "")',
    ).run(cardNum, noteNum, now, now);
    noteNum += 1;
    cardNum += 1;
  }

  for (const sha of shas) {
    const bytes = await deps.domain.media.read(sha);
    if (bytes === null) {
      continue;
    }
    const row = manifest.media.find((entry) => entry.sha256 === sha);
    const name = row?.originalName ?? `${sha.slice(0, 8)}.bin`;
    mediaMap[String(mediaIndex)] = name;
    zipEntries[String(mediaIndex)] = bytes;
    mediaIndex += 1;
  }

  const collection = db.serialize() as Buffer;
  db.close();

  zipEntries['collection.anki2'] = collection;
  zipEntries['media'] = strToU8(JSON.stringify(mediaMap));
  return Buffer.from(zipSync(zipEntries));
}
