import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { resetAuthViaCli } from './support/cli';
import { signInViaApi } from './support/api-signin';

const CLIENT_IP = '198.51.100.43';

const SHELL_PATHS = [
  '/',
  '/app.css',
  '/themes.css',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/shims/bootstrap.js',
  '/pkg/srep_ui.js',
  '/pkg/srep_ui_bg.wasm',
];

let context: BrowserContext;
let page: Page;

const handle = () => (window as any).__srepR12;

async function signIn(browser: Browser): Promise<void> {
  const setupToken = resetAuthViaCli();
  context = await browser.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': CLIENT_IP },
    viewport: { width: 1440, height: 900 },
  });
  page = await context.newPage();
  await signInViaApi(page, setupToken, 'SW');
}

async function waitForHandle(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as any).__srepR12));
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

// Wait until a service worker controls the page and the shell cache holds
// every precached asset. Returns the shell cache name.
async function waitForShellCache(page: Page): Promise<string> {
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  return pollUntil(
    () =>
      page.evaluate((expected) => {
        return (async () => {
          const names = await caches.keys();
          const shell = names.find((n) => n.startsWith('srep-shell-'));
          if (!shell) {
            return null;
          }
          const cache = await caches.open(shell);
          const keys = await cache.keys();
          const paths = keys.map((r) => new URL(r.url).pathname);
          return expected.every((p) => paths.includes(p)) ? shell : null;
        })();
      }, SHELL_PATHS),
    'shell cache to hold every precached asset',
  );
}

async function openRepo(page: Page): Promise<any> {
  return page.evaluate(() => (window as any).__srepR12.open());
}

async function seedPack(page: Page, packId: string, cardCount: number): Promise<void> {
  const pack = {
    packId,
    serverRevision: 'r13b-test',
    serverTimeMs: 1730000000000,
    serverTimeOffsetMs: 0,
    payload: {},
    cards: Array.from({ length: cardCount }, (_, i) => ({
      cardId: `card-${i}`,
      ordinal: i,
      reps: 0,
      payload: {},
    })),
  };
  await page.evaluate((arg) => (window as any).__srepR12.store_pack(arg), pack);
}

async function queue(page: Page, packId: string, cardId: string, rating = 3): Promise<any> {
  const review = {
    packId,
    cardId,
    rating,
    expectedReps: 0,
    elapsedMs: 100,
    clientOccurredAtMs: 1730000000000,
  };
  return page.evaluate(
    (arg) => (window as any).__srepR12.queue_review(arg),
    review,
  );
}

// Durable identity of the outbox (excludes the transient `sending` marker,
// which recovery resets on open).
async function outboxIdentity(page: Page): Promise<any[]> {
  const records = await page.evaluate(() => (window as any).__srepR12.pending_outbox());
  return records.map((r: any) => ({
    reviewId: r.reviewId,
    deviceId: r.deviceId,
    seq: r.seq,
    packId: r.packId,
    cardId: r.cardId,
    rating: r.rating,
    expectedReps: r.expectedReps,
    elapsedMs: r.elapsedMs,
    clientOccurredAtMs: r.clientOccurredAtMs,
  }));
}

async function cachedUrls(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        urls.push(request.url);
      }
    }
    return urls;
  });
}

test.beforeAll(async ({ browser }) => {
  await signIn(browser);
});

test.afterAll(async () => {
  await context?.close();
});

test.afterEach(async () => {
  // Tests that go offline restore connectivity for the next test.
  await context.setOffline(false);
});

test('cold offline launch serves the shell from cache', async () => {
  await page.goto('/');
  await expect(page.locator('.screen-title')).toContainText('Your library');
  await waitForShellCache(page);

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });

  // The navigation was served by the service worker: the shell mounts
  // with no network at all.
  await expect(page.locator('.screen-title')).toContainText('Your library');
  await expect(page).toHaveTitle('srep');
  const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
  expect(controlled).toBe(true);
});

test('service-worker upgrade preserves the IDB contents exactly', async () => {
  await page.goto('/');
  await waitForHandle(page);
  const beforeReport = await openRepo(page);
  await seedPack(page, 'r13b-pack', 3);
  await queue(page, 'r13b-pack', 'card-0', 3);
  await queue(page, 'r13b-pack', 'card-1', 4);
  const beforeOutbox = await outboxIdentity(page);
  const beforePack = await page.evaluate(() => (window as any).__srepR12.get_pack('r13b-pack'));
  expect(beforeOutbox).toHaveLength(2);

  // Seed a stale shell cache: activate must delete it, and only it.
  await page.evaluate(async () => {
    const stale = await caches.open('srep-shell-stale-test');
    await stale.put('/stale', new Response('stale'));
  });
  await waitForShellCache(page);

  // Register the same worker under a new script URL: a real upgrade path
  // (install -> skipWaiting -> activate -> claim) with the same scope.
  await page.evaluate(() =>
    navigator.serviceWorker.register('/sw.js?r13b-upgrade', { scope: '/' }),
  );
  await page.waitForFunction(
    () =>
      (navigator.serviceWorker.controller?.scriptURL ?? '').includes('r13b-upgrade'),
    undefined,
    { timeout: 30_000 },
  );

  // Activation (and its old-cache cleanup) can land after the new worker
  // takes control, so wait for the cleanup instead of asserting immediately.
  await pollUntil(
    async () => {
      const names = await page.evaluate(() => caches.keys());
      const shell = names.filter((n) => n.startsWith('srep-shell-'));
      return shell.length === 1 && !names.includes('srep-shell-stale-test');
    },
    'service-worker upgrade to delete the stale shell cache',
  );

  const cacheNames = await page.evaluate(() => caches.keys());
  expect(cacheNames.filter((n) => n.startsWith('srep-shell-'))).toHaveLength(1);
  expect(cacheNames).not.toContain('srep-shell-stale-test');

  // Reload under the new worker and re-read the repository.
  await page.reload();
  await waitForHandle(page);
  const afterReport = await openRepo(page);
  expect(afterReport.deviceId).toBe(beforeReport.deviceId);
  expect(await outboxIdentity(page)).toEqual(beforeOutbox);
  const afterPack = await page.evaluate(() => (window as any).__srepR12.get_pack('r13b-pack'));
  expect(afterPack).toEqual(beforePack);
});

test('Cache Storage holds no authenticated API responses', async () => {
  await page.goto('/');
  await expect(page.locator('.screen-title')).toContainText('Your library');
  await waitForShellCache(page);

  // The decks page has issued authenticated API calls by now; also make
  // one explicitly so the assertion cannot pass vacuously.
  const apiResponse = await page.request.get('/api/decks');
  expect(apiResponse.status()).toBe(200);

  const urls = await cachedUrls(page);
  expect(urls.length).toBeGreaterThan(0);
  expect(urls.filter((u) => u.includes('/api/'))).toEqual([]);
  const paths = urls.map((u) => new URL(u).pathname).sort();
  expect(paths).toEqual([...SHELL_PATHS].sort());
});
