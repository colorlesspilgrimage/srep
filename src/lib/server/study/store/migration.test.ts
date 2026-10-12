import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { addNote, deckRow, execSql } from '#lib/server/domain/store/suite-support.js';
import { setCard } from '#lib/server/study/store/study-suite-support.js';
import { createStudyHarness, type StudyHarness } from '#lib/server/study/test-support/harness.js';
import { queryRows } from '#lib/server/study/test-support/simulation-checks.js';

const root = path.resolve(import.meta.dirname, '../../../../..');

// The backfill is the last statement of migration 0003 in each dialect.
function backfillOf(dialect: 'sqlite' | 'pg'): string {
  const folder = path.join(root, 'drizzle', dialect);
  const file = fs.readdirSync(folder).find((name) => name.startsWith('0003_'));
  const text = fs.readFileSync(path.join(folder, file ?? 'missing'), 'utf8');
  return (text.split('--> statement-breakpoint').at(-1) ?? '').trim();
}

let h: StudyHarness | undefined;
afterEach(async () => {
  await h?.close();
});

describe('migration 0003 (sqlite)', () => {
  it('adds the scheduling columns', async () => {
    h = await createStudyHarness();
    const cardColumns = await queryRows<{ name: string }>(h.handle, sql`pragma table_info(card)`);
    expect(cardColumns.map((c) => c.name)).toEqual(
      expect.arrayContaining(['sched_state', 'learning_step']),
    );
    const logColumns = await queryRows<{ name: string }>(
      h.handle,
      sql`pragma table_info(review_log)`,
    );
    expect(logColumns.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'last_review_before',
        'reps_before',
        'lapses_before',
        'step_before',
        'buried_sibling_ids',
      ]),
    );
  });

  it('backfills sched_state from the M2 state, the same in both dialects', async () => {
    const statement = backfillOf('sqlite');
    expect(statement.startsWith('UPDATE card SET sched_state')).toBe(true);
    expect(backfillOf('pg')).toBe(statement);
    h = await createStudyHarness();
    await h.store.insertDeck(deckRow('d1', 'D1'));
    await addNote(h, 'a', ['d1', 'd1', 'd1', 'd1', 'd1']);
    // M2 rows: sched_state has the column default 'new'.
    await setCard(h, 'a-c0', { state: 'suspended', reps: 3 });
    await setCard(h, 'a-c1', { state: 'suspended', reps: 0 });
    await setCard(h, 'a-c2', { state: 'buried', reps: 2 });
    await setCard(h, 'a-c3', { state: 'review', reps: 4 });
    await execSql(h, sql.raw(statement));
    const rows = await queryRows<{ id: string; sched_state: string }>(
      h.handle,
      sql`select id, sched_state from card order by id`,
    );
    expect(rows.map((r) => r.sched_state)).toEqual(['review', 'new', 'review', 'review', 'new']);
  });
});
