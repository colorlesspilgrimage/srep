import Database from 'better-sqlite3';
import { strToU8, zipSync } from 'fflate';

export function buildMinimalApkg(opts: {
  front: string;
  back: string;
  deckName?: string;
  media?: { name: string; bytes: Buffer };
}): Buffer {
  const now = Math.floor(Date.now() / 1000);
  const db = new Database(':memory:');
  db.exec(`
    create table col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null);
    create table notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
    create table cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
  `);
  const deckName = opts.deckName ?? 'Fixture';
  const decks = { '1': { id: 1, name: deckName, usn: 0, mod: now } };
  const models = {
    '1': {
      id: 1,
      name: 'Basic',
      type: 0,
      flds: [
        { name: 'Front', ord: 0 },
        { name: 'Back', ord: 1 },
      ],
      tmpls: [{ name: 'Card 1', ord: 0, qfmt: '{{Front}}', afmt: '{{Front}}<hr>{{Back}}' }],
      css: '',
    },
  };
  db.prepare(
    'insert into col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags) values (1, ?, ?, 0, 11, 0, 0, 0, ?, ?, ?, ?, ?)',
  ).run(now, now, '{}', JSON.stringify(models), JSON.stringify(decks), '{}', '{}');
  const flds = `${opts.front}\u001f${opts.back}`;
  db.prepare(
    "insert into notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data) values (1, ?, 1, ?, 0, '', ?, 0, 0, 0, '')",
  ).run('fixture-guid', now, flds);
  db.prepare(
    "insert into cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data) values (1, 1, 1, 0, ?, 0, 0, 0, ?, 0, 2500, 0, 0, 0, 0, 0, 0, '')",
  ).run(now, now);

  const zip: Record<string, Uint8Array> = {
    'collection.anki2': db.serialize() as Buffer,
    media: strToU8('{}'),
  };
  if (opts.media !== undefined) {
    zip['0'] = opts.media.bytes;
    zip.media = strToU8(JSON.stringify({ '0': opts.media.name }));
  }
  db.close();
  return Buffer.from(zipSync(zip));
}
