import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { signInViaApi } from './support/api-signin';
import { resetAuthViaCli } from './support/cli';
import { addNote, createDeck, openStudy, removeRootDecks } from './support/study-screen';

type PackSummary = { packId: string };
type StoredPack = {
  cards: Array<{
    ordinal: number;
    payload: { front: string };
  }>;
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

test.describe.serial('R13a offline study pack', () => {
  test.setTimeout(60_000);

  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const setupToken = resetAuthViaCli();
    context = await browser.newContext({
      extraHTTPHeaders: { 'x-forwarded-for': '198.51.100.53' },
      viewport: { width: 1440, height: 900 },
    });
    page = await context.newPage();
    await signInViaApi(page, setupToken, 'R13a');
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

  test('online load stores a pack; a cold offline launch shows the exact pack with zero server mutations', async () => {
    // The server DB persists across runs of this file; clear any deck left
    // by an earlier run so the fixed deck name does not 409.
    await removeRootDecks(page);
    const deckId = await createDeck(page, 'R13a offline pack');
    const cards = [
      { front: 'Pack Q1', back: 'Pack A1' },
      { front: 'Pack Q2', back: 'Pack A2' },
      { front: 'Pack Q3', back: 'Pack A3' },
    ];

    for (const card of cards) {
      await addNote(page, deckId, card.front, card.back);
    }

    await openStudy(page, deckId);
    await expect(page.locator('.study-card')).toBeVisible();

    // openStudy navigates, which reinstalls the test handle with a fresh
    // (not yet open) repository state — reopen it before polling.
    await waitForHandle(page);
    await openRepo(page);

    await expect
      .poll(async () => (await listPacks(page)).length, { timeout: 15_000 })
      .toBe(1);

    const packs = await listPacks(page);
    expect(packs).toHaveLength(1);
    const stored = await getPack(page, packs[0]!.packId);
    expect(stored.cards).toHaveLength(3);
    expect(stored.cards.map((card) => card.ordinal)).toEqual([0, 1, 2]);
    for (const [index, card] of cards.entries()) {
      expect(stored.cards[index]!.payload.front).toContain(card.front);
    }

    const apiRequests: string[] = [];
    let postRequests = 0;
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/api/')) {
        apiRequests.push(url);
      }
      if (request.method() === 'POST') {
        postRequests += 1;
      }
    });

    try {
      await context.setOffline(true);
      await page.goto(`/study?deck=${encodeURIComponent(deckId)}`);
      await expect(page.locator('[data-offline-pack="true"]')).toBeVisible();

      await expect(
        page.getByRole('heading', { name: 'Offline pack', level: 2 }),
      ).toBeVisible();
      await expect(
        page
          .locator('.offline-pack')
          .locator('p')
          .filter({ hasText: 'Generated' }),
      ).toBeVisible();
      await expect(page.locator('.offline-pack-stale')).toHaveCount(0);
      await expect(page.locator('.study-front')).toContainText('Pack Q1');
      await expect(page.locator('.study-back')).toHaveCount(0);

      for (const name of ['Again', 'Hard', 'Good', 'Easy', 'Undo']) {
        await expect(
          page.getByRole('button', { name, exact: true }),
        ).toHaveCount(0);
      }

      await page.getByRole('button', { name: 'Reveal', exact: true }).click();
      await expect(page.locator('.study-back')).toBeVisible();
      await expect(page.locator('.study-back')).toContainText('Pack A1');

      await page.getByRole('button', { name: 'Next card', exact: true }).click();
      await expect(page.locator('.study-front')).toContainText('Pack Q2');
      await page.getByRole('button', { name: 'Next card', exact: true }).click();
      await expect(page.locator('.study-front')).toContainText('Pack Q3');
      await page.getByRole('button', { name: 'Next card', exact: true }).click();
      await expect(
        page.getByText('End of offline pack.', { exact: true }),
      ).toBeVisible();
      await page
        .getByRole('button', { name: 'Previous card', exact: true })
        .click();
      await expect(page.locator('.study-front')).toContainText('Pack Q3');

      expect(apiRequests).toEqual([]);
      expect(postRequests).toBe(0);
    } finally {
      await context.setOffline(false);
    }
  });

  test('a stale stored pack shows the stale warning', async () => {
    const pack = {
      packId: crypto.randomUUID(),
      serverRevision: 'r13a-test',
      serverTimeMs: Date.now() - 25 * 60 * 60 * 1000,
      serverTimeOffsetMs: 0,
      payload: {},
      cards: [
        {
          cardId: 'card-0',
          ordinal: 0,
          reps: 0,
          payload: {
            id: 'card-0',
            noteId: 'note-0',
            reps: 0,
            front: 'Stale Q',
            back: 'Stale A',
            previews: {},
          },
        },
      ],
    };

    await page.evaluate(
      (arg) => (window as any).__srepR12.store_pack(arg),
      pack,
    );
    expect((await listPacks(page)).map((entry) => entry.packId)).toEqual([
      pack.packId,
    ]);

    try {
      await context.setOffline(true);
      await page.goto('/study');
      await expect(page.locator('[data-offline-pack="true"]')).toBeVisible();
      await expect(page.locator('.offline-pack-stale')).toBeVisible();
      await expect(page.locator('.study-front')).toContainText('Stale Q');
    } finally {
      await context.setOffline(false);
    }
  });

  test('offline with no stored pack shows the load error', async () => {
    try {
      await context.setOffline(true);
      await page.goto('/study');
      await expect(
        page.getByText('Could not load study cards.', { exact: true }),
      ).toBeVisible();
      await expect(page.locator('[data-offline-pack="true"]')).toHaveCount(0);
    } finally {
      await context.setOffline(false);
    }
  });
});
