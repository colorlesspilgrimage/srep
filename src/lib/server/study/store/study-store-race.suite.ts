// Contract: Postgres race cases for answer and undo against a concurrent card-state change
// (CWE-362). A second connection suspends the card and holds its row lock. The study write
// starts, waits for that lock, and must then see the suspended row. On SQLite every
// transaction is synchronous, so the cases are skipped there.
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { describe, expect, it } from 'vitest';
import { fail } from '#lib/server/auth/deps.js';
import { addNote, countRows } from '#lib/server/domain/store/suite-support.js';
import { planUndo } from '#lib/server/study/core/answer-plan.js';
import {
  answerVia,
  readCardRow,
  type MakeStudyHarness,
} from '#lib/server/study/store/study-suite-support.js';

const MAX_LOCK_POLLS = 500;

type HeldSuspend = { release: () => void; done: Promise<void> };

// Suspends the card in an open transaction and keeps the row lock until release().
async function holdSuspend(db: PostgresJsDatabase, cardId: string): Promise<HeldSuspend> {
  const gate = Promise.withResolvers<void>();
  const suspended = Promise.withResolvers<void>();
  const done = db.transaction(async (tx) => {
    await tx.execute(sql`update card set state = 'suspended' where id = ${cardId}`);
    suspended.resolve();
    await gate.promise;
  });
  await suspended.promise;
  return { release: () => gate.resolve(), done };
}

// Polls until some session waits for a lock. The poll count has a bound.
async function waitForBlockedSession(db: PostgresJsDatabase): Promise<void> {
  for (let poll = 0; poll < MAX_LOCK_POLLS; poll += 1) {
    const rows = await db.execute<{ n: string }>(
      sql`select count(*) as n from pg_locks where not granted`,
    );
    if (Number(rows[0]?.n ?? 0) > 0) {
      return;
    }
    const pause = Promise.withResolvers<void>();
    setTimeout(pause.resolve, 10);
    await pause.promise;
  }
  throw new Error('no session waited for the card row lock');
}

export function defineStudyRaceSuite(open: MakeStudyHarness): void {
  describe('answer and undo against a concurrent suspend (CWE-362)', () => {
    it('an answer does not overwrite a suspend that commits first', async (ctx) => {
      const s = await open();
      if (s.handle.dialect !== 'postgres') {
        ctx.skip();
        return;
      }
      await addNote(s, 'a', ['d1']);
      const held = await holdSuspend(s.handle.db, 'a-c0');
      const answering = answerVia(s, 'a-c0');
      await waitForBlockedSession(s.handle.db);
      held.release();
      await held.done;
      expect(await answering).toEqual(fail(409, 'card_not_studyable'));
      expect((await readCardRow(s, 'a-c0'))?.state).toBe('suspended');
      expect(await countRows(s, 'review_log')).toBe(0);
    });

    it('an undo keeps a suspend that commits first', async (ctx) => {
      const s = await open();
      if (s.handle.dialect !== 'postgres') {
        ctx.skip();
        return;
      }
      await addNote(s, 'a', ['d1']);
      expect(await answerVia(s, 'a-c0')).toMatchObject({ ok: true });
      const held = await holdSuspend(s.handle.db, 'a-c0');
      const undoing = s.studyStore.undoLastReview(planUndo);
      await waitForBlockedSession(s.handle.db);
      held.release();
      await held.done;
      expect(await undoing).toMatchObject({ ok: true });
      expect(await readCardRow(s, 'a-c0')).toMatchObject({
        state: 'suspended',
        schedState: 'new',
        reps: 0,
      });
    });
  });
}
