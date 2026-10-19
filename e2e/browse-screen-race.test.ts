import { expect, test, type Page } from '@playwright/test';
import { E2E_ORIGIN } from './support/cli';
import { signInEditor } from './support/note-editor';
import { BASIC_ID, createDeck, csrf } from './support/study-screen';

// Contract: one bulk write at a time, a stale search loses, and a failed write can be retried.
// This file uses 198.51.100.45. note-editor-race uses .43 and browse-screen uses .44.
// Browse has no client clock. is:due stays on the server clock from slice 12.

const CLIENT_IP = '198.51.100.45';
const SUSPEND = (url: URL) => url.pathname === '/api/cards/suspend';
const BROWSE = (url: URL) => url.pathname === '/api/browse';

let page: Page;
let alfa = '';

function hold() {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { gate, release };
}

function dataRows(current: Page) {
  return current.getByRole('row').filter({ has: current.getByRole('checkbox') });
}

function queryOf(url: string): string {
  return new URL(url).searchParams.get('q') ?? '';
}

async function search(current: Page, q: string): Promise<void> {
  const field = current.getByLabel('Search');
  await field.fill(q);
  await field.press('Enter');
}

async function postCard(current: Page, deckId: string, front: string): Promise<string> {
  const response = await current.request.post('/api/notes', {
    headers: {
      origin: E2E_ORIGIN,
      'x-srep-csrf': await csrf(current),
      'content-type': 'application/json',
    },
    data: { noteTypeId: BASIC_ID, deckId, fields: [front, `${front}-back`], tags: [] },
  });
  expect(response.status()).toBe(201);
  const body: { note: { cards: { id: string }[] } } = await response.json();
  const cardId = body.note.cards[0]?.id;
  if (cardId === undefined) {
    throw new Error('missing card');
  }
  return cardId;
}

async function armSuspend(
  current: Page,
  gate: Promise<void>,
  seen: { posts: number; body: string },
): Promise<void> {
  await current.route(SUSPEND, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    seen.posts += 1;
    seen.body = route.request().postData() ?? '';
    await gate;
    await route.continue();
  });
}

test.describe.serial('browse races', () => {
  test.beforeAll(async ({ browser }) => {
    const signed = await signInEditor(browser, CLIENT_IP);
    page = signed.page;
    const deckId = await createDeck(page, 'Race');
    alfa = await postCard(page, deckId, 'alfa');
    await postCard(page, deckId, 'beta');
    await postCard(page, deckId, 'gamma');
    await page.goto('/browse');
    await page.waitForFunction(() => document.body.classList.contains('tui-page'));
    await expect(dataRows(page)).toHaveCount(3);
  });

  test.afterAll(async () => {
    await page.context().close();
  });

  test('a second bulk action sends no second write', async () => {
    await page.getByRole('checkbox', { name: 'Select alfa' }).check();
    const pending = hold();
    const seen = { posts: 0, moves: 0, body: '' };
    const onRequest = (request: { method: () => string; url: () => string }) => {
      if (request.method() === 'POST' && request.url().includes('/api/cards/move')) {
        seen.moves += 1;
      }
    };
    page.on('request', onRequest);
    await armSuspend(page, pending.gate, seen);
    try {
      await page.getByRole('button', { name: 'Suspend' }).click();
      await expect.poll(() => seen.posts).toBe(1);
      await expect(page.getByRole('button', { name: 'Move', exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Delete' })).toBeDisabled();
      await page.getByRole('checkbox', { name: 'Select beta' }).check();
      await page.getByRole('button', { name: 'Suspend' }).click({ force: true });
      await page.getByRole('button', { name: 'Move', exact: true }).click({ force: true });
      await page.getByRole('button', { name: 'Delete' }).click({ force: true });
      expect(seen.posts).toBe(1);
      expect(seen.moves).toBe(0);
      await expect(page.getByRole('dialog', { name: 'Delete selected notes' })).toBeHidden();
      expect(JSON.parse(seen.body)).toEqual({ cardIds: [alfa] });
    } finally {
      pending.release();
      page.off('request', onRequest);
    }
    await expect(dataRows(page).filter({ hasText: 'alfa' })).toContainText('suspended');
    await expect(dataRows(page).filter({ hasText: 'beta' })).not.toContainText('suspended');
    await page.unroute(SUSPEND);
  });

  test('a slow search does not replace a later search', async () => {
    const pending = hold();
    let held = false;
    await page.route(BROWSE, async (route) => {
      if (queryOf(route.request().url()) === 'alfa') {
        held = true;
        await pending.gate;
      }
      await route.continue();
    });
    try {
      await search(page, 'alfa');
      await expect.poll(() => held).toBe(true);
      await search(page, 'beta');
      await expect(dataRows(page)).toHaveCount(1);
      await expect(dataRows(page).first()).toContainText('beta');
      const slow = page.waitForResponse(
        (response) => response.url().includes('/api/browse') && queryOf(response.url()) === 'alfa',
      );
      pending.release();
      await slow;
      await expect(dataRows(page)).toHaveCount(1);
      await expect(dataRows(page).first()).toContainText('beta');
    } finally {
      pending.release();
      await page.unroute(BROWSE);
    }
  });

  test('a failed search keeps the rows and the next search clears it', async () => {
    await search(page, '');
    await expect(dataRows(page)).toHaveCount(3);
    await page.route(BROWSE, (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'error' }),
      }),
    );
    await search(page, 'gamma');
    await expect(page.getByRole('alert')).toHaveText('The request failed.');
    await expect(dataRows(page)).toHaveCount(3);
    await page.unroute(BROWSE);
    await search(page, 'gamma');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(dataRows(page)).toHaveCount(1);
    await expect(dataRows(page).first()).toContainText('gamma');
  });

  test('a failed suspend stays on screen and a retry suspends that card', async () => {
    await search(page, '');
    await page.getByRole('checkbox', { name: 'Select gamma' }).check();
    let posts = 0;
    await page.route(SUSPEND, async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      posts += 1;
      if (posts === 1) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'error' }),
        });
        return;
      }
      await route.continue();
    });
    await page.getByRole('button', { name: 'Suspend' }).click();
    await expect(page.getByRole('alert')).toHaveText('The request failed.');
    await expect(page.getByRole('button', { name: 'Suspend' })).toBeEnabled();
    await expect(dataRows(page).filter({ hasText: 'gamma' })).not.toContainText('suspended');
    await page.getByRole('button', { name: 'Suspend' }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(dataRows(page).filter({ hasText: 'gamma' })).toContainText('suspended');
    expect(posts).toBe(2);
    await page.unroute(SUSPEND);
  });
});
