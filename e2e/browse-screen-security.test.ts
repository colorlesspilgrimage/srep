import { expect, test, type Page } from '@playwright/test';
import { signInEditor } from './support/note-editor';
import { E2E_ORIGIN } from './support/cli';
import { createDeck, csrf } from './support/study-screen';

// Contract: guest access, hostile text, URL tamper, and delete-dialog races.
// This file uses 198.51.100.46. browse-screen uses .44. browse-screen-race uses .45.

const CLIENT_IP = '198.51.100.46';
const BASIC_ID = '00000000-0000-4000-8000-000000000011';
const HOSTILE = '<img src=x onerror=alert(1)';
const HEBREW = 'שלום';
const DECK = `Nest\u202e<script`;

let page: Page;

function rows(current: Page = page) {
  return current.getByRole('row').filter({ has: current.getByRole('checkbox') });
}

function dialog() {
  return page.getByRole('dialog', { name: 'Delete selected notes' });
}

function hold() {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { gate, release };
}

async function search(q: string): Promise<void> {
  const field = page.getByLabel('Search');
  await field.fill(q);
  await field.press('Enter');
  await page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/api/browse' && (url.searchParams.get('q') ?? '') === q;
  });
}

async function postFront(deckId: string, front: string): Promise<void> {
  const response = await page.request.post('/api/notes', {
    headers: {
      origin: E2E_ORIGIN,
      'x-srep-csrf': await csrf(page),
      'content-type': 'application/json',
    },
    data: { noteTypeId: BASIC_ID, deckId, fields: [front, 'back'], tags: ['keep'] },
  });
  expect(response.status()).toBe(201);
}

test('a guest cannot read browse or its write APIs', async ({ request }) => {
  const headers = { 'x-forwarded-for': CLIENT_IP };
  const document = await request.get(
    '/browse?q=%3Cscript%3E&cursor=javascript:alert(1)&next=https://example.invalid',
    { maxRedirects: 0, headers },
  );
  expect(document.status()).toBe(303);
  expect(document.headers().location).toMatch(/\/(setup|login)$/);
  const paths = ['/api/browse?cursor=javascript:alert(1)&q=%3Cscript%3E', '/api/decks'];
  for (const path of paths) {
    const response = await request.get(path, { maxRedirects: 0, headers });
    expect(response.status(), path).toBe(401);
    expect(response.headers()['cache-control'] ?? '', path).toContain('no-store');
  }
  for (const path of [
    '/api/cards/move',
    '/api/cards/suspend',
    '/api/notes/tags',
    '/api/notes/trash',
  ]) {
    const response = await request.post(path, { maxRedirects: 0, headers, data: {} });
    expect(response.status(), path).toBe(401);
    expect(response.headers()['cache-control'] ?? '', path).toContain('no-store');
  }
});

test.describe.serial('browse security', () => {
  test.beforeAll(async ({ browser }) => {
    const signed = await signInEditor(browser, CLIENT_IP);
    page = signed.page;
    const deckId = await createDeck(page, DECK);
    await postFront(deckId, 'alpha');
    await postFront(deckId, HOSTILE);
    await postFront(deckId, HEBREW);
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  test('a tampered browse URL does not redirect or send the cursor', async () => {
    const seen: string[] = [];
    const onRequest = (request: { url: () => string }) => {
      seen.push(request.url());
    };
    page.on('request', onRequest);
    const pending = page.waitForResponse((response) => {
      return new URL(response.url()).pathname === '/api/browse';
    });
    const response = await page.goto(
      '/browse?q=%3Cscript%3E&cursor=not-a-uuid&next=https://example.invalid',
    );
    await page.waitForFunction(() => document.body.classList.contains('tui-page'));
    const browse = await pending;
    page.off('request', onRequest);
    expect(response?.headers()['cache-control']).toBe('no-store');
    expect(response?.headers()['vary']?.toLowerCase()).toContain('cookie');
    const api = new URL(browse.url());
    expect(api.searchParams.get('q')).toBe('');
    expect(api.searchParams.has('cursor')).toBe(false);
    const here = new URL(page.url());
    expect(here.origin).toBe('http://localhost:4173');
    expect(here.pathname).toBe('/browse');
    expect(seen.every((url) => new URL(url).hostname !== 'example.invalid')).toBe(true);
    await expect(rows()).toHaveCount(3);
    await expect(page.locator('.browse-grid img, .browse-grid script')).toHaveCount(0);
    await expect(page.getByRole('gridcell', { name: HOSTILE, exact: true })).toBeVisible();
    const bidi = await page
      .getByRole('gridcell', { name: 'Nest' })
      .first()
      .evaluate((node) => getComputedStyle(node).unicodeBidi);
    expect(bidi).toBe('isolate');
  });

  test('a filter drops ids that are not on the page', async () => {
    await page.getByRole('checkbox', { name: 'Select alpha' }).check();
    await page.getByRole('checkbox', { name: `Select ${HEBREW}` }).check();
    await search('alpha');
    await expect(rows()).toHaveCount(1);
    let body = '';
    const onRequest = (request: {
      method: () => string;
      url: () => string;
      postData: () => string | null;
    }) => {
      if (request.method() === 'POST' && request.url().includes('/api/cards/suspend')) {
        body = request.postData() ?? '';
      }
    };
    page.on('request', onRequest);
    await page.getByRole('button', { name: 'Suspend' }).click();
    await expect(rows().first()).toContainText('suspended');
    page.off('request', onRequest);
    expect(JSON.parse(body).cardIds).toHaveLength(1);
    await search(HEBREW);
    await expect(rows().first()).not.toContainText('suspended');
  });

  test('a failed suspend keeps the captured row and the query', async () => {
    await search('');
    await expect(rows()).toHaveCount(3);
    await page.getByRole('checkbox', { name: `Select ${HOSTILE}` }).check();
    const pending = hold();
    let posts = 0;
    await page.route('**/api/cards/suspend', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      posts += 1;
      if (posts === 1) {
        await pending.gate;
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
    await expect.poll(() => posts).toBe(1);
    await expect(page.getByLabel('Search')).toBeDisabled();
    const other = page.getByRole('checkbox', { name: `Select ${HEBREW}` });
    await expect(other).toBeDisabled();
    await page.getByRole('button', { name: 'Suspend' }).click({ force: true });
    expect(posts).toBe(1);
    pending.release();
    await expect(page.getByRole('alert')).toHaveText('The request failed.');
    await expect(page.getByLabel('Search')).toHaveValue('');
    await expect(page.getByRole('checkbox', { name: `Select ${HOSTILE}` })).toBeChecked();
    await expect(other).not.toBeChecked();
    await page.getByRole('button', { name: 'Suspend' }).click();
    await expect(rows().filter({ hasText: HOSTILE })).toContainText('suspended');
    await expect(rows().filter({ hasText: HEBREW })).not.toContainText('suspended');
    expect(posts).toBe(2);
    await page.unroute('**/api/cards/suspend');
  });

  test('the delete dialog traps focus and deletes only the opened set', async () => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.getByRole('checkbox', { name: `Select ${HEBREW}` }).check();
    const opener = page.getByRole('button', { name: 'Delete' });
    await opener.click();
    await expect(dialog()).toBeVisible();
    await expect(dialog()).toBeFocused();
    await expect(dialog().getByRole('button', { name: 'Confirm delete' })).not.toBeFocused();
    for (const name of ['Cancel', 'Confirm delete']) {
      const box = await dialog().getByRole('button', { name }).boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    const before = await page.evaluate(() => window.scrollY);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
    for (const key of ['Delete', 'Backspace', '1', '2', '3', '4', 'ArrowDown']) {
      await page.keyboard.press(key);
    }
    await expect(dialog()).toBeVisible();
    await expect(rows().filter({ hasText: HEBREW })).toBeVisible();
    const other = page.getByRole('checkbox', { name: 'Select alpha' });
    await expect(other).toBeDisabled();
    await page.keyboard.press('Tab');
    await expect(dialog().getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog().getByRole('button', { name: 'Confirm delete' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog().getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog().getByRole('button', { name: 'Confirm delete' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog().getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog()).toBeHidden();
    await expect(opener).toBeFocused();
    await expect(rows().filter({ hasText: HEBREW })).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
    await opener.click();
    const pending = hold();
    let posts = 0;
    await page.route('**/api/notes/trash', async (route) => {
      posts += 1;
      if (posts === 1) {
        await pending.gate;
      }
      await route.continue();
    });
    await dialog().getByRole('button', { name: 'Confirm delete' }).click();
    await expect.poll(() => posts).toBe(1);
    await dialog().getByRole('button', { name: 'Confirm delete' }).click({ force: true });
    expect(posts).toBe(1);
    pending.release();
    await expect(dialog()).toBeHidden();
    await expect(rows().filter({ hasText: HEBREW })).toHaveCount(0);
    await expect(rows().filter({ hasText: 'alpha' })).toBeVisible();
    await page.unroute('**/api/notes/trash');
  });
});
