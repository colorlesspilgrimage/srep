import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { signInViaApi } from './support/api-signin';
import { E2E_ORIGIN, resetAuthViaCli } from './support/cli';
import {
  addNote,
  createDeck,
  removeRootDecks,
} from './support/study-screen';

type PackSummary = { packId: string };
type StoredPack = {
  pack: { serverTimeMs: number };
  cards: Array<{
    cardId: string;
    ordinal: number;
    reps: number;
    answered: boolean;
    payload: { id: string; reps: number; front: string; back: string };
  }>;
};
type OutboxRecord = {
  reviewId: string;
  deviceId: string;
  seq: number;
  packId: string;
  cardId: string;
  rating: number;
  expectedReps: number;
  clientOccurredAtMs: number;
  packServerTimeMs: number;
};
type AckedReview = {
  reviewId: string;
  logId: string;
  cardId: string;
  packId: string;
  superseded: boolean;
};
type UndoReconcileReport = {
  returnedEvents: number;
  supersededReviews: string[];
  cardIds: string[];
  cursorMs: number;
};
type SyncReport = {
  attempted: number;
  acked: number;
  duplicates: number;
  conflictsParked: number;
  leftPending: number;
  status: string | { Failed: { reason: string } };
};

const RATING_NAMES: Record<number, string> = {
  1: 'Again',
  2: 'Hard',
  3: 'Good',
  4: 'Easy',
};

async function waitForHandle(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as any).__srepR12));
}

async function waitForR17(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as any).__srepR17));
}

async function openRepo(page: Page): Promise<any> {
  return page.evaluate(() => (window as any).__srepR12.open());
}

async function listPacks(page: Page): Promise<PackSummary[]> {
  return page.evaluate(() => (window as any).__srepR12.list_packs());
}

async function getPack(page: Page, packId: string): Promise<StoredPack> {
  return page.evaluate(
    (id) => (window as any).__srepR12.get_pack(id),
    packId,
  );
}

async function pendingOutbox(page: Page): Promise<OutboxRecord[]> {
  const records: OutboxRecord[] = await page.evaluate(() =>
    (window as any).__srepR12.pending_outbox(),
  );
  return records.sort((left, right) => left.seq - right.seq);
}

async function drain(page: Page): Promise<SyncReport> {
  return page.evaluate(() => (window as any).__srepR16.drain());
}

async function reconcile(page: Page): Promise<UndoReconcileReport> {
  return page.evaluate(() => (window as any).__srepR17.reconcile());
}

async function ackedReviews(page: Page): Promise<AckedReview[]> {
  return page.evaluate(() => (window as any).__srepR17.acked_reviews());
}

async function exportDiagnostics(page: Page): Promise<any> {
  return page.evaluate(() => (window as any).__srepR12.export_diagnostics());
}

// Playwright 1.64.0's waitForFunction does not re-poll a promise-returning
// predicate: it resolves as soon as the returned promise object is truthy,
// even when the promise resolves to false. Async conditions therefore need
// a manual poll loop.
async function pollUntil<T>(
  check: () => Promise<T | null | false>,
  label: string,
  timeoutMs = 30_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result) {
      return result;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function revealAndRate(
  page: Page,
  rating: 1 | 2 | 3 | 4,
): Promise<void> {
  await page.getByRole('button', { name: 'Reveal', exact: true }).click();
  await expect(page.locator('.study-back')).toBeVisible();
  await page
    .getByRole('button', {
      name: new RegExp(`^${RATING_NAMES[rating]!} `),
    })
    .click();
}

async function seedRealDeck(
  page: Page,
  name: string,
  cards: Array<{ front: string; back: string }>,
): Promise<{ deckId: string; studyUrl: string }> {
  await removeRootDecks(page);
  const deckId = await createDeck(page, name);
  for (const card of cards) {
    await addNote(page, deckId, card.front, card.back);
  }
  const studyUrl = `/study?offline=1&deck=${encodeURIComponent(deckId)}`;
  await page.goto(studyUrl);
  await expect(page.locator('.study-card')).toBeVisible();
  await waitForHandle(page);
  await waitForR17(page);
  await openRepo(page);
  await expect
    .poll(async () => (await listPacks(page)).length, { timeout: 15_000 })
    .toBe(1);
  return { deckId, studyUrl };
}

test.describe.serial('R17 offline reconciliation', () => {
  test.setTimeout(90_000);

  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const setupToken = resetAuthViaCli();
    context = await browser.newContext({
      extraHTTPHeaders: { 'x-forwarded-for': '198.51.100.54' },
      viewport: { width: 1440, height: 900 },
    });
    page = await context.newPage();
    await signInViaApi(page, setupToken, 'R17');
  });

  test.beforeEach(async () => {
    await page.goto('/');
    await waitForHandle(page);
    await page.evaluate(() => (window as any).__srepR12.delete_database());
    await openRepo(page);
  });

  test.afterEach(async () => {
    await context.setOffline(false);
    await page.evaluate(() => (window as any).__srepR12?.close());
  });

  test.afterAll(async () => {
    if (context) {
      await context.close();
    }
  });

  async function post<T>(path: string, data: unknown, expected = 200): Promise<T> {
    const status = await page.request.get('/api/auth/status');
    const { csrfToken }: { csrfToken: string } = await status.json();
    const response = await page.request.post(path, {
      headers: {
        origin: E2E_ORIGIN,
        'x-srep-csrf': csrfToken,
        'content-type': 'application/json',
      },
      data,
    });
    expect(response.status(), path).toBe(expected);
    return response.json();
  }

  test('offline answer → sync → undo → reconcile supersedes the acked review and the card is due again', async () => {
    const { studyUrl } = await seedRealDeck(page, 'R17 reconciliation', [
      { front: 'R17 Q1', back: 'R17 A1' },
      { front: 'R17 Q2', back: 'R17 A2' },
    ]);
    const packs = await listPacks(page);
    const stored = await getPack(page, packs[0]!.packId);
    expect(stored.cards).toHaveLength(2);
    const firstCardId = stored.cards[0]!.cardId;

    // Answer the first card offline.
    await context.setOffline(true);
    await page.goto(studyUrl);
    await expect(page.locator('[data-offline-pack="true"]')).toBeVisible();
    await waitForHandle(page);
    await waitForR17(page);
    await openRepo(page);
    await expect(page.locator('.study-front')).toContainText('R17 Q1');
    await revealAndRate(page, 3);
    await expect(page.locator('.study-front')).toContainText('R17 Q2');

    const queued = await pendingOutbox(page);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.seq).toBe(1);
    expect(queued[0]!.cardId).toBe(firstCardId);
    const reviewId = queued[0]!.reviewId;

    // Back online: drain acks it and the durable ledger records it.
    await context.setOffline(false);
    const report = await drain(page);
    expect(report.acked).toBe(1);
    expect(report.leftPending).toBe(0);
    const acked = await ackedReviews(page);
    expect(acked).toHaveLength(1);
    expect(acked[0]!.reviewId).toBe(reviewId);
    expect(acked[0]!.cardId).toBe(firstCardId);
    expect(acked[0]!.superseded).toBe(false);
    const logId = acked[0]!.logId;
    expect(logId.length).toBeGreaterThan(0);

    // Undo the synced review on the server.
    const undone = await post<{ undone: { reviewId: string; cardId: string } }>(
      '/api/study/undo',
      {},
    );
    expect(undone.undone.reviewId).toBe(logId);
    expect(undone.undone.cardId).toBe(firstCardId);

    // Reconcile: the tombstone supersedes the ledger entry and unmarks
    // the pack card, and the cursor advances past the undo.
    const reconciled = await reconcile(page);
    expect(reconciled.returnedEvents).toBe(1);
    expect(reconciled.supersededReviews).toEqual([reviewId]);
    expect(reconciled.cardIds).toEqual([firstCardId]);
    expect(reconciled.cursorMs).toBeGreaterThan(0);
    const ackedAfter = await ackedReviews(page);
    expect(ackedAfter).toHaveLength(1);
    expect(ackedAfter[0]!.superseded).toBe(true);
    const storedAfter = await getPack(page, packs[0]!.packId);
    expect(storedAfter.cards[0]!.answered).toBe(false);

    // A second reconcile sees nothing new (the cursor advanced).
    const again = await reconcile(page);
    expect(again.returnedEvents).toBe(0);
    expect(again.supersededReviews).toEqual([]);

    // The card is due again: online, and in the offline pack view.
    await page.goto(studyUrl);
    await expect(page.locator('.study-front')).toContainText('R17 Q1');
    await expect
      .poll(
        async () => {
          const current = await listPacks(page);
          if (current.length === 0) {
            return null;
          }
          const fresh = await getPack(page, current[0]!.packId);
          return fresh.cards.some(
            (card) => card.cardId === firstCardId && !card.answered,
          )
            ? true
            : null;
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    await context.setOffline(true);
    await page.goto(studyUrl);
    await expect(page.locator('[data-offline-pack="true"]')).toBeVisible();
    await expect(page.locator('.study-front')).toContainText('R17 Q1');
    await expect(page.locator('.offline-card-queued')).toHaveCount(0);
  });

  test('a long-lived pack warns, answers, and still syncs (OQ3)', async () => {
    const { studyUrl } = await seedRealDeck(page, 'R17 long-lived pack', [
      { front: 'R17 Old Q1', back: 'R17 Old A1' },
    ]);
    const packs = await listPacks(page);
    const stored = await getPack(page, packs[0]!.packId);
    const twoDaysAgo = Date.now() - 2 * 86_400_000;

    // Rewrite the stored pack as if it had been generated two days ago.
    await page.evaluate(
      (arg) => (window as any).__srepR12.store_pack(arg),
      {
        packId: packs[0]!.packId,
        serverRevision: 'r17-test',
        serverTimeMs: twoDaysAgo,
        serverTimeOffsetMs: 0,
        payload: { generatedAt: twoDaysAgo },
        cards: stored.cards.map((card, ordinal) => ({
          cardId: card.cardId,
          ordinal,
          reps: card.reps,
          payload: card.payload,
        })),
      },
    );

    await context.setOffline(true);
    await page.goto(studyUrl);
    await expect(page.locator('[data-offline-pack="true"]')).toBeVisible();
    await expect(page.locator('.offline-pack-stale')).toBeVisible();
    await expect(page.locator('.study-front')).toContainText('R17 Old Q1');
    await revealAndRate(page, 3);
    await expect(
      page.getByText('End of offline pack.', { exact: true }),
    ).toBeVisible();
    expect((await pendingOutbox(page)).length).toBe(1);

    await context.setOffline(false);
    const report = await drain(page);
    expect(report.acked).toBe(1);
    expect(report.leftPending).toBe(0);
    expect((await ackedReviews(page)).length).toBe(1);
  });

  test('diagnostics expose persistence, offsets, ledger counts, and the cursor; settings shows them', async () => {
    const { studyUrl } = await seedRealDeck(page, 'R17 diagnostics', [
      { front: 'R17 D Q1', back: 'R17 D A1' },
    ]);
    await context.setOffline(true);
    await page.goto(studyUrl);
    await expect(page.locator('[data-offline-pack="true"]')).toBeVisible();
    await revealAndRate(page, 3);
    await context.setOffline(false);
    const report = await drain(page);
    expect(report.acked).toBe(1);
    const reconciled = await reconcile(page);
    expect(reconciled.cursorMs).toBeGreaterThan(0);

    const diagnostics = await exportDiagnostics(page);
    expect(['granted', 'notGranted', 'unavailable']).toContain(
      diagnostics.persistence,
    );
    expect(diagnostics.outboxServerTimeOffsetsMs).toEqual([]);
    expect(diagnostics.ackedReviewCount).toBe(1);
    expect(diagnostics.supersededReviewCount).toBe(0);
    expect(diagnostics.undoCursorMs).toBeGreaterThan(0);

    await page.goto('/settings');
    await expect(page.getByText('Persistent storage:')).toBeVisible();
    await expect(
      page.getByText('Synced reviews kept for undo checks: 1 (0 superseded by an undo)'),
    ).toBeVisible();
    await expect(page.getByText(/Last undo check:/)).toBeVisible();
  });

  test('service-worker upgrade preserves a pending review and it still drains', async () => {
    const { studyUrl } = await seedRealDeck(page, 'R17 sw upgrade', [
      { front: 'R17 SW Q1', back: 'R17 SW A1' },
    ]);
    const packs = await listPacks(page);
    const stored = await getPack(page, packs[0]!.packId);
    const firstCardId = stored.cards[0]!.cardId;

    await context.setOffline(true);
    await page.goto(studyUrl);
    await expect(page.locator('[data-offline-pack="true"]')).toBeVisible();
    await revealAndRate(page, 3);
    const queued = await pendingOutbox(page);
    expect(queued).toHaveLength(1);
    const reviewId = queued[0]!.reviewId;
    await context.setOffline(false);

    // Register the same worker under a new script URL: a real upgrade
    // path (install -> skipWaiting -> activate -> claim).
    await page.evaluate(() =>
      navigator.serviceWorker.register('/sw.js?r17-upgrade', { scope: '/' }),
    );
    await page.waitForFunction(
      () =>
        (navigator.serviceWorker.controller?.scriptURL ?? '').includes(
          'r17-upgrade',
        ),
      undefined,
      { timeout: 30_000 },
    );
    await pollUntil(
      async () => {
        const names = await page.evaluate(() => caches.keys());
        const shell = names.filter((n) => n.startsWith('srep-shell-'));
        return shell.length === 1 ? true : null;
      },
      'service-worker upgrade to settle on one shell cache',
    );

    await page.reload();
    await waitForHandle(page);
    await waitForR17(page);
    await openRepo(page);
    const after = await pendingOutbox(page);
    expect(after).toHaveLength(1);
    expect(after[0]!.reviewId).toBe(reviewId);
    expect(after[0]!.cardId).toBe(firstCardId);

    const report = await drain(page);
    expect(report.acked).toBe(1);
    expect(report.leftPending).toBe(0);
    expect((await ackedReviews(page)).length).toBe(1);
  });
});
