import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { signInViaApi } from './support/api-signin';
import { resetAuthViaCli } from './support/cli';
import {
  addNote,
  createDeck,
  openStudy,
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
type SeedCard = {
  id: string;
  front: string;
  back: string;
  reps: number;
  state?: string;
  schedState?: string;
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

async function warmStudyShellAndWipe(page: Page): Promise<void> {
  await page.goto('/study');
  await expect(
    page.getByRole('heading', { name: 'Study', level: 1 }),
  ).toBeVisible();
  await waitForHandle(page);
  await openRepo(page);
  await expect
    .poll(async () => (await listPacks(page)).length, { timeout: 15_000 })
    .toBe(1);
  await page.evaluate(() => (window as any).__srepR12.delete_database());
  await openRepo(page);
}

async function seedPack(
  page: Page,
  cards: SeedCard[],
): Promise<{ packId: string; cardIds: string[] }> {
  const packId = crypto.randomUUID();
  const now = Date.now();
  const pack = {
    packId,
    serverRevision: 'r14-test',
    serverTimeMs: now,
    serverTimeOffsetMs: 0,
    payload: { generatedAt: now },
    cards: cards.map((card, ordinal) => ({
      cardId: card.id,
      ordinal,
      reps: card.reps,
      payload: {
        id: card.id,
        noteId: `note-${card.id}`,
        reps: card.reps,
        front: card.front,
        back: card.back,
        state: card.state,
        schedState: card.schedState,
        previews: {},
      },
    })),
  };
  await page.evaluate(
    (arg) => (window as any).__srepR12.store_pack(arg),
    pack,
  );
  expect((await listPacks(page)).map((entry) => entry.packId)).toEqual([
    packId,
  ]);
  return { packId, cardIds: cards.map((card) => card.id) };
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

function seededCards(count: number, prefix: string): SeedCard[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    front: `${prefix} Q${index}`,
    back: `${prefix} A${index}`,
    reps: 0,
  }));
}

test.describe.serial('R14 offline answering', () => {
  test.setTimeout(90_000);

  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const setupToken = resetAuthViaCli();
    context = await browser.newContext({
      extraHTTPHeaders: { 'x-forwarded-for': '198.51.100.53' },
      viewport: { width: 1440, height: 900 },
    });
    page = await context.newPage();
    await signInViaApi(page, setupToken, 'R14');
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

  test('flag on + offline: answers queue into the outbox exactly once, zero server mutations', async () => {
    await removeRootDecks(page);
    const deckId = await createDeck(page, 'R14 offline answering');
    const cards = [
      { front: 'R14 Pack Q1', back: 'R14 Pack A1' },
      { front: 'R14 Pack Q2', back: 'R14 Pack A2' },
      { front: 'R14 Pack Q3', back: 'R14 Pack A3' },
    ];
    for (const card of cards) {
      await addNote(page, deckId, card.front, card.back);
    }

    const studyUrl = `/study?offline=1&deck=${encodeURIComponent(deckId)}`;
    await page.goto(studyUrl);
    await expect(page.locator('.study-card')).toBeVisible();
    await waitForHandle(page);
    const report = await openRepo(page);
    const deviceId: string = report.deviceId;
    await expect
      .poll(async () => (await listPacks(page)).length, { timeout: 15_000 })
      .toBe(1);
    const packs = await listPacks(page);
    const stored = await getPack(page, packs[0]!.packId);
    expect(stored.cards).toHaveLength(3);

    const apiRequests: string[] = [];
    let postRequests = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST') {
        postRequests += 1;
      }
    });
    page.on('response', (response) => {
      if (response.url().includes('/api/')) {
        apiRequests.push(response.url());
      }
    });

    const answerWindowStart = Date.now();
    let originalReviewIds: string[] = [];
    try {
      await context.setOffline(true);
      await page.goto(studyUrl);
      await expect(page.locator('[data-offline-pack="true"]')).toBeVisible();
      await waitForHandle(page);
      await openRepo(page);

      const ratings = [3, 2, 4] as const;
      for (const [index, rating] of ratings.entries()) {
        await expect(page.locator('.study-front')).toContainText(
          cards[index]!.front,
        );
        await revealAndRate(page, rating);
        if (index < 2) {
          await expect(page.locator('.study-front')).toContainText(
            cards[index + 1]!.front,
          );
        }
      }

      await expect(
        page.getByText('End of offline pack.', { exact: true }),
      ).toBeVisible();
      await expect(page.getByText(pendingText(3), { exact: true })).toBeVisible();

      const records = await pendingOutbox(page);
      expect(records).toHaveLength(3);
      expect(records.map((record) => record.seq)).toEqual([1, 2, 3]);
      expect(records.map((record) => record.cardId)).toEqual(
        stored.cards.map((card) => card.cardId),
      );
      expect(records.map((record) => record.rating)).toEqual([3, 2, 4]);
      expect(records.map((record) => record.expectedReps)).toEqual(
        stored.cards.map((card) => card.reps),
      );
      originalReviewIds = records.map((record) => record.reviewId);
      for (const record of records) {
        expect(record.packId).toBe(stored.cards.length > 0 ? packs[0]!.packId : '');
        expect(record.deviceId).toBe(deviceId);
        expect(record.packServerTimeMs).toBe(stored.pack.serverTimeMs);
        expect(record.clientOccurredAtMs).toBeGreaterThanOrEqual(
          answerWindowStart,
        );
        expect(record.clientOccurredAtMs).toBeLessThanOrEqual(Date.now());
      }

      await page.reload();
      await expect(page.locator('[data-offline-pack="true"]')).toBeVisible();
      await waitForHandle(page);
      await openRepo(page);
      await expect(
        page.getByText('End of offline pack.', { exact: true }),
      ).toBeVisible();
      await expect(page.getByText(pendingText(3), { exact: true })).toBeVisible();
      const reloaded = await pendingOutbox(page);
      expect(reloaded).toHaveLength(3);
      expect(reloaded.map((record) => record.seq)).toEqual([1, 2, 3]);
      expect(reloaded.map((record) => record.reviewId)).toEqual(
        originalReviewIds,
      );

      expect(apiRequests).toEqual([]);
      expect(postRequests).toBe(0);
    } finally {
      await context.setOffline(false);
    }
  });

  test('50 answers survive repeated reloads without duplication or reordering', async () => {
    test.setTimeout(180_000);
    await warmStudyShellAndWipe(page);
    const { cardIds } = await seedPack(page, seededCards(50, 'r14-fifty'));

    try {
      await context.setOffline(true);
      await page.goto('/study?offline=1');
      await expect(page.locator('[data-offline-pack="true"]')).toBeVisible();
      await waitForHandle(page);
      await openRepo(page);

      for (let index = 0; index < 50; index += 1) {
        await expect(page.locator('.study-front')).toContainText(
          `r14-fifty Q${index}`,
        );
        await revealAndRate(page, 3);
      }
      await expect(
        page.getByText('End of offline pack.', { exact: true }),
      ).toBeVisible();
      await expect(page.getByText(pendingText(50), { exact: true })).toBeVisible();

      for (let reload = 0; reload < 2; reload += 1) {
        await page.reload();
        await expect(page.locator('[data-offline-pack="true"]')).toBeVisible();
        await waitForHandle(page);
        await openRepo(page);
        await expect(
          page.getByText('End of offline pack.', { exact: true }),
        ).toBeVisible();
        const records = await pendingOutbox(page);
        expect(records).toHaveLength(50);
        expect(records.map((record) => record.seq)).toEqual(
          Array.from({ length: 50 }, (_, index) => index + 1),
        );
        expect(new Set(records.map((record) => record.reviewId)).size).toBe(50);
        expect(records.map((record) => record.cardId)).toEqual(cardIds);
      }
    } finally {
      await context.setOffline(false);
    }
  });

  test('a learning card is answered once and never requeued', async () => {
    await warmStudyShellAndWipe(page);
    const { cardIds } = await seedPack(page, [
      {
        id: 'r14-learning',
        front: 'R14 learning question',
        back: 'R14 learning answer',
        reps: 1,
        state: 'learning',
        schedState: 'learning',
      },
      {
        id: 'r14-review',
        front: 'R14 review question',
        back: 'R14 review answer',
        reps: 5,
        state: 'review',
        schedState: 'review',
      },
    ]);

    try {
      await context.setOffline(true);
      await page.goto('/study?offline=1');
      await expect(page.locator('[data-offline-pack="true"]')).toBeVisible();
      await waitForHandle(page);
      await openRepo(page);
      await expect(page.locator('.study-front')).toContainText(
        'R14 learning question',
      );
      await revealAndRate(page, 3);
      await expect(page.locator('.study-front')).toContainText(
        'R14 review question',
      );
      await expect(page.locator('.study-front')).not.toContainText(
        'R14 learning question',
      );
      await revealAndRate(page, 4);
      await expect(
        page.getByText('End of offline pack.', { exact: true }),
      ).toBeVisible();

      const records = await pendingOutbox(page);
      expect(records.filter((record) => record.cardId === cardIds[0])).toHaveLength(1);
      expect(records.filter((record) => record.cardId === cardIds[1])).toHaveLength(1);

      await page.reload();
      await expect(page.locator('[data-offline-pack="true"]')).toBeVisible();
      await waitForHandle(page);
      await openRepo(page);
      await expect(
        page.getByText('End of offline pack.', { exact: true }),
      ).toBeVisible();
      const reloaded = await pendingOutbox(page);
      expect(reloaded).toHaveLength(2);
      expect(reloaded.filter((record) => record.cardId === cardIds[0])).toHaveLength(1);
    } finally {
      await context.setOffline(false);
    }
  });

  test('cancel the latest unsent review (OQ5)', async () => {
    await warmStudyShellAndWipe(page);
    const { cardIds } = await seedPack(page, seededCards(3, 'r14-cancel'));

    try {
      await context.setOffline(true);
      await page.goto('/study?offline=1');
      await expect(page.locator('[data-offline-pack="true"]')).toBeVisible();
      await waitForHandle(page);
      await openRepo(page);

      await revealAndRate(page, 3);
      await expect(page.locator('.study-front')).toContainText('r14-cancel Q1');
      await revealAndRate(page, 4);
      await expect(page.locator('.study-front')).toContainText('r14-cancel Q2');
      const beforeCancel = await pendingOutbox(page);
      expect(beforeCancel.map((record) => record.seq)).toEqual([1, 2]);
      const cancelledReviewId = beforeCancel[1]!.reviewId;

      await page
        .getByRole('button', { name: 'Cancel last answer', exact: true })
        .click();
      await expect(page.locator('.study-front')).toContainText('r14-cancel Q1');
      await expect(
        page.getByRole('button', { name: 'Reveal', exact: true }),
      ).toBeVisible();
      await expect.poll(async () => (await pendingOutbox(page)).length).toBe(1);
      const afterCancel = await pendingOutbox(page);
      expect(afterCancel[0]!.seq).toBe(1);
      expect(afterCancel[0]!.cardId).toBe(cardIds[0]);

      await revealAndRate(page, 2);
      await expect(page.locator('.study-front')).toContainText('r14-cancel Q2');
      const afterReanswer = await pendingOutbox(page);
      expect(afterReanswer.map((record) => record.seq)).toEqual([1, 2]);
      expect(afterReanswer[1]!.rating).toBe(2);
      expect(afterReanswer[1]!.reviewId).not.toBe(cancelledReviewId);

      await page.reload();
      await expect(page.locator('[data-offline-pack="true"]')).toBeVisible();
      await waitForHandle(page);
      await openRepo(page);
      const reloaded = await pendingOutbox(page);
      expect(reloaded.map((record) => record.reviewId)).toEqual(
        afterReanswer.map((record) => record.reviewId),
      );
      expect(reloaded.map((record) => record.seq)).toEqual([1, 2]);
    } finally {
      await context.setOffline(false);
    }
  });

  test('flag off keeps the read-only fallback and online answering is unchanged', async () => {
    await warmStudyShellAndWipe(page);
    await seedPack(page, seededCards(1, 'r14-readonly'));

    try {
      await context.setOffline(true);
      await page.goto('/study');
      await expect(page.locator('[data-offline-pack="true"]')).toBeVisible();
      await waitForHandle(page);
      await openRepo(page);
      await page.getByRole('button', { name: 'Reveal', exact: true }).click();
      await expect(page.locator('.study-back')).toBeVisible();
      await expect(page.locator('.offline-pack .study-rate')).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Cancel last answer', exact: true }),
      ).toHaveCount(0);
      expect(await pendingOutbox(page)).toEqual([]);
    } finally {
      await context.setOffline(false);
    }

    await removeRootDecks(page);
    const deckId = await createDeck(page, 'R14 online answering');
    await addNote(page, deckId, 'R14 online Q', 'R14 online A');
    await openStudy(page, deckId);
    await page.goto(`/study?offline=1&deck=${encodeURIComponent(deckId)}`);
    await expect(page.locator('.study-card')).toBeVisible();
    await waitForHandle(page);
    await openRepo(page);
    await revealAndRate(page, 4);
    await expect(page.getByText('No cards left.', { exact: true })).toBeVisible();

    const next = await page.request.get(
      `/api/study/next?deckId=${encodeURIComponent(deckId)}`,
    );
    expect(next.ok()).toBeTruthy();
    const body: { status: string } = await next.json();
    expect(body.status).toBe('done');
    expect(await pendingOutbox(page)).toEqual([]);
  });
});
