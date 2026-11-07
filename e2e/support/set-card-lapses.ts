import Database from 'better-sqlite3';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LAPSES = 1_000_000;

function readArgs(): { cardId: string; lapses: number } {
  const cardId = process.argv[2] ?? '';
  const lapses = Number(process.argv[3]);
  if (!UUID.test(cardId) || !Number.isInteger(lapses) || lapses < 0 || lapses > MAX_LAPSES) {
    throw new Error('lapse update missed');
  }
  return { cardId, lapses };
}

function sqlitePath(url: string): string {
  if (!url.startsWith('sqlite:')) {
    throw new Error('lapse update missed: only sqlite E2E URLs supported');
  }
  const rest = url.slice('sqlite:'.length);
  return rest.startsWith('/') || rest.startsWith('./') ? rest : `./${rest}`;
}

function main(): void {
  const url = process.env.SREP_DATABASE_URL;
  if (url === undefined || url.length === 0) {
    throw new Error('lapse update missed');
  }
  const { cardId, lapses } = readArgs();
  const db = new Database(sqlitePath(url));
  try {
    const info = db.prepare('UPDATE card SET lapses = ? WHERE id = ?').run(lapses, cardId);
    if (info.changes !== 1) {
      throw new Error('lapse update missed');
    }
  } finally {
    db.close();
  }
}

main();
