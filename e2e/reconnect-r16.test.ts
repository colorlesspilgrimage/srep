import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { signInViaApi } from './support/api-signin';
import { resetAuthViaCli } from './support/cli';
import {
  addNote,
  createDeck,
  openStudy,
  removeRootDecks,
} from './support/study-screen';

type SyncStatus =
  | 'Drained'
  | 'Empty'
  | 'AuthFailed'
  | { Failed: { reason: string } };
type SyncReport = {
  attempted: number;
  acked: number;
  duplicates: number;
  conflictsParked: number;
  leftPending: number;
  status: SyncStatus;
  serverTimeMs: number | null;
  logHead: unknown;
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
type ConflictRecord = {
  conflictId: string;
  reviewId: string;
  deviceId: string;
  seq: number;
  packId: string;
  cardId: string;
  reason: string;
  localReview: {
    reviewId: string;
    cardId: string;
    rating: number;
    expectedReps: number;
    elapsedMs: number;
    clientOccurredAtMs: number;
  };
  serverResponse: unknown;
  detectedAtMs: number;
};
type StoredPack = {
  pack: { serverTimeMs: number };
  cards: Array<{ cardId: string; reps: number }>;
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

async function openRepo(page: Page): Promise<any> {
  return page.evaluate(() => (window as any).__srepR12.open());
}

async function listPacks(page: Page): Promise<Array<{ packId: string }>> {
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

async function listConflicts(page: Page): Promise<ConflictRecord[]> {
  return page.evaluate(() => (window as any).__srepR12.list_conflicts());
}

async function drain(page: Page): Promise<SyncReport> {
  return page.evaluate(() => (window as any).__srepR16.drain());
}

async function reportHistory(page: Page): Promise<SyncReport[]> {
  try {
    return await page.evaluate(() => (window as any).__srepR16.reports());
  } catch {
    return [];
  }
}

async function waitForReport(
  page: Page,
  predicate: (report: SyncReport) => boolean,
  timeoutMs = 20_000,
): Promise<SyncReport> {
  const deadline = Date.now() + timeoutMs;
  let last: SyncReport[] = [];
  while (true) {
    last = await reportHistory(page);
    const found = last.find(predicate);
    if (found) {
      return found;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `timed out waiting for a matching drain report; history: ${JSON.stringify(last)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/// Reconnect and wait for a drain matching `predicate`. The mounted study
/// screen drains on the `online` event; if that did not happen (for example
/// the page was mid-navigation), a fresh load of the study URL drains in its
/// load effect.
async function reconnectAndWaitForDrain(
  page: Page,
  studyUrl: string,
  predicate: (report: SyncReport) => boolean,
  timeoutMs = 20_000,
): Promise<SyncReport> {
  try {
    return await waitForReport(page, predicate, timeoutMs);
  } catch {
    await page.goto(studyUrl);
    await expect(page.locator('.study-card, [data-offline-pack="true"]')).toBeVisible();
    await waitForHandle(page);
    await openRepo(page);
    return await waitForReport(page, predicate, timeoutMs);
  }
}

async function reviewsToday(page: Page): Promise<number> {
  const response = await page.request.get('/api/stats/today');
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  return body.today.reviews as number;
}

async function csrfToken(page: Page): Promise<string> {
  const response = await page.request.get('/api/auth/status');
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(typeof body.csrfToken).toBe('string');
  return body.csrfToken as string;
}

async function expectNoServerMismatches(page: Page): Promise<void> {
  const token = await csrfToken(page);
  const response = await page.request.post('/api/study/verify', {
    headers: { 'x-srep-csrf': token },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.report.mismatches).toEqual([]);
  expect(body.report.chainMismatches).toEqual([]);
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

function pendingText(count: number): string {
  return `${count} answer(s) queued — will sync when you're back online`;
}

/// Create a deck with `count` real cards and fetch its offline pack while
/// online, then answer every card offline. Returns the study URL, the pack's
/// card ids, and the server review count before any offline answer.
async function answerOffline(
  page: Page,
  context: BrowserContext,
  deckName: string,
  cards: Array<{ front: string; back: string }>,
  ratings: Array<1 | 2 | 3 | 4>,
): Promise<{ studyUrl: string; cardIds: string[]; baselineReviews: number }> {
  await removeRootDecks(page);
  const deckId = await createDeck(page, deckName);
  for (const card of cards) {
    await addNote(page, deckId, card.front, card.back);
  }
  const baselineReviews = await reviewsToday(page);

  const studyUrl = `/study?offline=1&deck=${encodeURIComponent(deckId)}`;
  await page.goto(studyUrl);
  await expect(page.locator('.study-card')).toBeVisible();
  await waitForHandle(page);
  await openRepo(page);
  await expect
    .poll(async () => (await listPacks(page)).length, { timeout: 15_000 })
    .toBe(1);
  const packs = await listPacks(page);
  const stored = await getPack(page, packs[0]!.packId);
  expect(stored.cards).toHaveLength(cards.length);
  const cardIds = stored.cards.map((card) => card.cardId);

  await context.setOffline(true);
  await page.goto(studyUrl);
  await expect(page.locator('[data-offline-pack="true"]')).toBeVisible();
  await waitForHandle(page);
  await openRepo(page);

  for (const [index, rating] of ratings.entries()) {
    await expect(page.locator('.study-front')).toContainText(
      cards[index]!.front,
    );
    await revealAndRate(page, rating);
  }
  await expect(
    page.getByText('End of offline pack.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(pendingText(cards.length), { exact: true }),
  ).toBeVisible();
  const records = await pendingOutbox(page);
  expect(records).toHaveLength(cards.length);
  expect(records.map((record) => record.seq)).toEqual(
    cards.map((_, index) => index + 1),
  );
  expect(records.map((record) => record.cardId)).toEqual(cardIds);

  return { studyUrl, cardIds, baselineReviews };
}

/// Second device for the same account: copy the session cookie from context
/// A. A fresh context means a fresh IndexedDB, hence a new device UUID.
async function openSecondDevice(
  browser: Browser,
  contextA: BrowserContext,
): Promise<{ context: BrowserContext; page: Page }> {
  const cookies = await contextA.cookies();
  const session = cookies.find((cookie) => cookie.name === 'srep_session');
  expect(session).toBeDefined();
  const context = await browser.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': '198.51.100.54' },
    viewport: { width: 1440, height: 900 },
  });
  await context.addCookies([session!]);
  const page = await context.newPage();
  return { context, page };
}

test.describe.serial('R16 reconnect + conflict recovery', () => {
  test.setTimeout(120_000);

  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const setupToken = resetAuthViaCli();
    context = await browser.newContext({
      extraHTTPHeaders: { 'x-forwarded-for': '198.51.100.53' },
      viewport: { width: 1440, height: 900 },
    });
    page = await context.newPage();
    await signInViaApi(page, setupToken, 'R16');
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

  test('offline answers drain in order on reconnect; outbox empties over the acked prefix', async () => {
    const cards = [
      { front: 'R16 drain Q1', back: 'R16 drain A1' },
      { front: 'R16 drain Q2', back: 'R16 drain A2' },
      { front: 'R16 drain Q3', back: 'R16 drain A3' },
    ];
    const { studyUrl, cardIds, baselineReviews } = await answerOffline(
      page,
      context,
      'R16 drain',
      cards,
      [3, 2, 4],
    );

    try {
      await context.setOffline(false);
      const report = await reconnectAndWaitForDrain(
        page,
        studyUrl,
        (candidate) =>
          candidate.status === 'Drained' && candidate.acked === 3,
      );
      expect(report.attempted).toBe(3);
      expect(report.duplicates).toBe(0);
      expect(report.conflictsParked).toBe(0);
      expect(report.leftPending).toBe(0);

      expect(await pendingOutbox(page)).toEqual([]);
      expect((await reviewsToday(page)) - baselineReviews).toBe(3);
      await expectNoServerMismatches(page);

      // The drained cards are no longer due.
      const next = await page.request.get(
        `/api/study/next?deckId=${encodeURIComponent(studyUrl.split('deck=')[1]!)}`,
      );
      expect(next.ok()).toBeTruthy();
      const body: { status: string } = await next.json();
      expect(body.status).toBe('done');
      expect(cardIds).toHaveLength(3);
    } finally {
      await context.setOffline(false);
    }
  });

  test('a lost sync response is retried as duplicates; each review applies exactly once', async () => {
    const cards = [
      { front: 'R16 lost Q1', back: 'R16 lost A1' },
      { front: 'R16 lost Q2', back: 'R16 lost A2' },
      { front: 'R16 lost Q3', back: 'R16 lost A3' },
    ];
    const { studyUrl, baselineReviews } = await answerOffline(
      page,
      context,
      'R16 lost response',
      cards,
      [3, 3, 3],
    );

    // The first drain's response never reaches the page: forward the request
    // to the real server, then abort it, so the server applies the batch
    // while the client sees a network failure.
    await page.route('**/api/study/sync', async (route) => {
      const request = route.request();
      await fetch(request.url(), {
        method: 'POST',
        headers: {
          ...request.headers(),
          host: new URL(request.url()).host,
        },
        body: request.postDataBuffer() ?? undefined,
      });
      await route.abort();
    });

    try {
      await context.setOffline(false);
      const failed = await reconnectAndWaitForDrain(
        page,
        studyUrl,
        (candidate) => typeof candidate.status === 'object' && 'Failed' in candidate.status,
        90_000,
      );
      expect(failed.attempted).toBe(3);
      expect(failed.leftPending).toBe(3);

      // The server applied the batch even though the client never saw it.
      expect((await reviewsToday(page)) - baselineReviews).toBe(3);
      // The outbox still holds every item: nothing was acked.
      expect((await pendingOutbox(page)).map((record) => record.seq)).toEqual([
        1, 2, 3,
      ]);
    } finally {
      await page.unroute('**/api/study/sync');
      await context.setOffline(false);
    }

    // A second drain returns the stored receipts as duplicates.
    const redrain = await drain(page);
    expect(redrain.status).toBe('Drained');
    expect(redrain.attempted).toBe(3);
    expect(redrain.acked).toBe(0);
    expect(redrain.duplicates).toBe(3);
    expect(redrain.leftPending).toBe(0);
    expect(await pendingOutbox(page)).toEqual([]);
    // Still exactly three server reviews: no double-apply.
    expect((await reviewsToday(page)) - baselineReviews).toBe(3);
    await expectNoServerMismatches(page);
  });

  test('two-device conflict: append anyway applies with a new operation id', async ({
    browser,
  }) => {
    await removeRootDecks(page);
    const deckId = await createDeck(page, 'R16 conflict append');
    await addNote(page, deckId, 'R16 conflict Q', 'R16 conflict A');
    const baselineReviews = await reviewsToday(page);
    const studyUrl = `/study?offline=1&deck=${encodeURIComponent(deckId)}`;

    const { context: contextB, page: pageB } = await openSecondDevice(
      browser,
      context,
    );
    try {
      // Device B fetches the pack while the card is still at reps 0.
      await pageB.goto(studyUrl);
      await expect(pageB.locator('.study-card')).toBeVisible();
      await waitForHandle(pageB);
      await openRepo(pageB);
      await expect
        .poll(async () => (await listPacks(pageB)).length, { timeout: 15_000 })
        .toBe(1);

      // Device A answers the same card online first.
      await openStudy(page, deckId);
      await expect(page.locator('.study-card')).toBeVisible();
      await revealAndRate(page, 3);
      await expect(page.getByText('No cards left.', { exact: true })).toBeVisible();
      expect((await reviewsToday(page)) - baselineReviews).toBe(1);

      // Device B answers the stale pack offline, then reconnects.
      await contextB.setOffline(true);
      await pageB.goto(studyUrl);
      await expect(pageB.locator('[data-offline-pack="true"]')).toBeVisible();
      await waitForHandle(pageB);
      await openRepo(pageB);
      await revealAndRate(pageB, 4);
      const queued = await pendingOutbox(pageB);
      expect(queued).toHaveLength(1);
      expect(queued[0]!.expectedReps).toBe(0);
      const staleReviewId = queued[0]!.reviewId;

      await contextB.setOffline(false);
      const conflictReport = await reconnectAndWaitForDrain(
        pageB,
        studyUrl,
        (candidate) =>
          candidate.status === 'Drained' && candidate.conflictsParked === 1,
      );
      expect(conflictReport.attempted).toBe(1);
      expect(conflictReport.acked).toBe(0);
      expect(conflictReport.leftPending).toBe(0);

      const conflicts = await listConflicts(pageB);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]!.reason).toBe('stale_card');
      expect(conflicts[0]!.reviewId).toBe(staleReviewId);
      expect((await reviewsToday(pageB)) - baselineReviews).toBe(1);

      await expect(
        pageB.getByTestId('sync-conflicts'),
      ).toBeVisible();
      await expect(pageB.getByTestId('sync-conflicts')).toContainText(
        'R16 conflict Q',
      );
      await expect(pageB.getByTestId('sync-conflicts')).toContainText(
        'Someone else reviewed this card first',
      );
      await expect(pageB.getByTestId('sync-conflicts')).toContainText(
        'current reps 1',
      );

      await pageB
        .getByRole('button', { name: 'Append anyway', exact: true })
        .click();
      await expect
        .poll(async () => (await listConflicts(pageB)).length, { timeout: 15_000 })
        .toBe(0);
      await expect(pageB.getByTestId('sync-conflicts')).toHaveCount(0);

      // The appended review applied with a new operation id: two reviews
      // total, and the parked conflict is gone, not silently dropped.
      expect((await reviewsToday(pageB)) - baselineReviews).toBe(2);
      expect(await pendingOutbox(pageB)).toEqual([]);
      await expectNoServerMismatches(pageB);
    } finally {
      await contextB.setOffline(false);
      await contextB.close();
    }
  });

  test('two-device conflict: discard with confirmation removes it and nothing is lost silently', async ({
    browser,
  }) => {
    await removeRootDecks(page);
    const deckId = await createDeck(page, 'R16 conflict discard');
    await addNote(page, deckId, 'R16 discard Q', 'R16 discard A');
    const baselineReviews = await reviewsToday(page);
    const studyUrl = `/study?offline=1&deck=${encodeURIComponent(deckId)}`;

    const { context: contextB, page: pageB } = await openSecondDevice(
      browser,
      context,
    );
    try {
      await pageB.goto(studyUrl);
      await expect(pageB.locator('.study-card')).toBeVisible();
      await waitForHandle(pageB);
      await openRepo(pageB);
      await expect
        .poll(async () => (await listPacks(pageB)).length, { timeout: 15_000 })
        .toBe(1);

      await openStudy(page, deckId);
      await expect(page.locator('.study-card')).toBeVisible();
      await revealAndRate(page, 2);
      await expect(page.getByText('No cards left.', { exact: true })).toBeVisible();
      expect((await reviewsToday(page)) - baselineReviews).toBe(1);

      await contextB.setOffline(true);
      await pageB.goto(studyUrl);
      await expect(pageB.locator('[data-offline-pack="true"]')).toBeVisible();
      await waitForHandle(pageB);
      await openRepo(pageB);
      await revealAndRate(pageB, 3);
      expect(await pendingOutbox(pageB)).toHaveLength(1);

      await contextB.setOffline(false);
      await reconnectAndWaitForDrain(
        pageB,
        studyUrl,
        (candidate) =>
          candidate.status === 'Drained' && candidate.conflictsParked === 1,
      );
      expect(await listConflicts(pageB)).toHaveLength(1);
      await expect(pageB.getByTestId('sync-conflicts')).toBeVisible();

      // First click only arms the confirmation.
      await pageB
        .getByRole('button', { name: 'Discard', exact: true })
        .click();
      expect(await listConflicts(pageB)).toHaveLength(1);
      await pageB
        .getByRole('button', { name: 'Discard? Yes, discard', exact: true })
        .click();
      await expect
        .poll(async () => (await listConflicts(pageB)).length, { timeout: 15_000 })
        .toBe(0);
      await expect(pageB.getByTestId('sync-conflicts')).toHaveCount(0);

      // Only device A's review exists server-side.
      expect((await reviewsToday(pageB)) - baselineReviews).toBe(1);
      expect(await pendingOutbox(pageB)).toEqual([]);
      await expectNoServerMismatches(pageB);
    } finally {
      await contextB.setOffline(false);
      await contextB.close();
    }
  });

  test('a stale card parks as a conflict while independent cards in the same batch proceed', async ({
    browser,
  }) => {
    await removeRootDecks(page);
    const deckId = await createDeck(page, 'R16 mixed batch');
    await addNote(page, deckId, 'R16 mixed stale Q', 'R16 mixed stale A');
    await addNote(page, deckId, 'R16 mixed fresh Q', 'R16 mixed fresh A');
    const baselineReviews = await reviewsToday(page);
    const studyUrl = `/study?offline=1&deck=${encodeURIComponent(deckId)}`;

    const { context: contextB, page: pageB } = await openSecondDevice(
      browser,
      context,
    );
    try {
      await pageB.goto(studyUrl);
      await expect(pageB.locator('.study-card')).toBeVisible();
      await waitForHandle(pageB);
      await openRepo(pageB);
      await expect
        .poll(async () => (await listPacks(pageB)).length, { timeout: 15_000 })
        .toBe(1);
      const packsB = await listPacks(pageB);
      const storedB = await getPack(pageB, packsB[0]!.packId);
      expect(storedB.cards).toHaveLength(2);
      const staleCardId = storedB.cards[0]!.cardId;

      // Device A answers only the first card online.
      await openStudy(page, deckId);
      await expect(page.locator('.study-card')).toBeVisible();
      await expect(page.locator('.study-front')).toContainText(
        'R16 mixed stale Q',
      );
      await revealAndRate(page, 3);
      await expect(page.locator('.study-front')).toContainText(
        'R16 mixed fresh Q',
      );
      // Leave the second card unanswered on device A; go back without
      // answering it by navigating away.
      await page.goto('/');

      // Device B answers both cards offline.
      await contextB.setOffline(true);
      await pageB.goto(studyUrl);
      await expect(pageB.locator('[data-offline-pack="true"]')).toBeVisible();
      await waitForHandle(pageB);
      await openRepo(pageB);
      await expect(pageB.locator('.study-front')).toContainText(
        'R16 mixed stale Q',
      );
      await revealAndRate(pageB, 4);
      await expect(pageB.locator('.study-front')).toContainText(
        'R16 mixed fresh Q',
      );
      await revealAndRate(pageB, 3);
      expect((await pendingOutbox(pageB)).map((record) => record.seq)).toEqual([
        1, 2,
      ]);

      await contextB.setOffline(false);
      const report = await reconnectAndWaitForDrain(
        pageB,
        studyUrl,
        (candidate) =>
          candidate.status === 'Drained' &&
          candidate.acked === 1 &&
          candidate.conflictsParked === 1,
      );
      expect(report.attempted).toBe(2);
      expect(report.leftPending).toBe(0);
      expect(await pendingOutbox(pageB)).toEqual([]);

      const conflicts = await listConflicts(pageB);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]!.cardId).toBe(staleCardId);
      expect(conflicts[0]!.reason).toBe('stale_card');
      // A's review + B's fresh-card review.
      expect((await reviewsToday(pageB)) - baselineReviews).toBe(2);
      await expectNoServerMismatches(pageB);
    } finally {
      await contextB.setOffline(false);
      await contextB.close();
    }
  });

  test('HTTP 500 is retried with backoff and then succeeds without user action', async () => {
    const cards = [
      { front: 'R16 retry Q1', back: 'R16 retry A1' },
      { front: 'R16 retry Q2', back: 'R16 retry A2' },
      { front: 'R16 retry Q3', back: 'R16 retry A3' },
    ];
    const { studyUrl, baselineReviews } = await answerOffline(
      page,
      context,
      'R16 retry 500',
      cards,
      [3, 3, 3],
    );

    const attemptTimes: number[] = [];
    await page.route('**/api/study/sync', async (route) => {
      attemptTimes.push(Date.now());
      if (attemptTimes.length <= 2) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: '{}',
        });
      } else {
        await route.continue();
      }
    });

    try {
      await context.setOffline(false);
      const report = await reconnectAndWaitForDrain(
        page,
        studyUrl,
        (candidate) =>
          candidate.status === 'Drained' && candidate.acked === 3,
        60_000,
      );
      expect(report.leftPending).toBe(0);
      expect(attemptTimes).toHaveLength(3);
      // Backoff is 1s before the second attempt and 2s before the third
      // (±25% jitter); the gaps prove retries waited instead of hammering.
      expect(attemptTimes[1]! - attemptTimes[0]!).toBeGreaterThanOrEqual(700);
      expect(attemptTimes[2]! - attemptTimes[1]!).toBeGreaterThanOrEqual(1400);
      expect((await reviewsToday(page)) - baselineReviews).toBe(3);
      expect(await pendingOutbox(page)).toEqual([]);
      await expectNoServerMismatches(page);
    } finally {
      await page.unroute('**/api/study/sync');
      await context.setOffline(false);
    }
  });
});
