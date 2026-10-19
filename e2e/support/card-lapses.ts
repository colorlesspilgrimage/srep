// Sets card.lapses on the end-to-end database.
// The child process reads SREP_DATABASE_URL. This file sets it from E2E_DATABASE_URL.
// When E2E_DATABASE_URL is empty, the URL is sqlite:./data/e2e.db.
// The card id is a UUID. The lapse count is a whole number from 0 to 1000000.

import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LAPSES = 1_000_000;

function databaseUrl(): string {
  const raw = process.env.E2E_DATABASE_URL;
  if (raw !== undefined && raw.length > 0) {
    return raw;
  }
  return 'sqlite:./data/e2e.db';
}

export function setCardLapses(cardId: string, lapses: number): void {
  if (!UUID.test(cardId) || !Number.isInteger(lapses) || lapses < 0 || lapses > MAX_LAPSES) {
    throw new Error('lapse update missed');
  }
  const result = spawnSync(
    'npx',
    ['tsx', 'e2e/support/set-card-lapses.ts', cardId, String(lapses)],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, SREP_DATABASE_URL: databaseUrl() },
    },
  );
  if (result.error !== undefined || result.status !== 0) {
    const detail = result.stderr || result.error?.message || 'no status';
    throw new Error(`lapse update missed: ${detail}`);
  }
}
