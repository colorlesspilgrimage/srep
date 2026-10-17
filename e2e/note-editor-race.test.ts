import { expect, test, type Page, type Route } from '@playwright/test';
import { makeDecks, openNewNote, postNote, signInEditor, TINY_PNG } from './support/note-editor';

// Contract: one save or upload at a time, a stale preview, and a failed retry.
// This file uses its own client IP.

const CLIENT_IP = '198.51.100.43';
const PNG = { name: 'dot.png', mimeType: 'image/png', buffer: TINY_PNG };

let page: Page;
let alpha = '';

function hold() {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { gate, release };
}

const NOTES_PATH = (url: URL) => url.pathname === '/api/notes';
const MEDIA_PATH = (url: URL) => url.pathname === '/api/media';
const PREVIEW_PATH = (url: URL) => url.pathname === '/api/notes/preview';

function fieldText(route: Route): string {
  const raw = route.request().postData();
  if (raw === null) {
    return '';
  }
  const body = JSON.parse(raw) as { fields?: unknown };
  const first = body.fields;
  if (!Array.isArray(first) || typeof first[0] !== 'string') {
    return '';
  }
  return first[0];
}

test.describe.serial('note editor races', () => {
  test.beforeAll(async ({ browser }) => {
    const signed = await signInEditor(browser, CLIENT_IP);
    page = signed.page;
    alpha = (await makeDecks(page)).alpha;
  });

  test.afterAll(async () => {
    await page.context().close();
  });

  test('a second Save during a held save does not send another request', async () => {
    await openNewNote(page, alpha);
    await page.getByLabel('Front').fill('held-save');
    await page.getByLabel('Back').fill('cat');
    const pending = hold();
    let posts = 0;
    await page.route(NOTES_PATH, async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      posts += 1;
      await pending.gate;
      await route.continue();
    });
    try {
      await page.getByRole('button', { name: 'Save' }).click();
      await expect.poll(() => posts).toBe(1);
      await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Cloze 1' })).toBeDisabled();
      await expect(page.getByLabel('Upload')).toBeDisabled();
      await expect(page.getByLabel('Camera')).toBeDisabled();
      const deck = page.getByRole('listbox', { name: 'Deck' });
      await expect(deck).toHaveAttribute('aria-disabled', 'true');
      await page.getByRole('button', { name: 'Save' }).click({ force: true });
      await deck.getByRole('option', { name: 'Beta' }).click({ force: true });
      expect(posts).toBe(1);
      await expect(deck.getByRole('option', { selected: true })).toHaveText('Alpha');
    } finally {
      pending.release();
    }
    await page.waitForURL(/\/notes\/[0-9a-f-]{36}$/i);
    expect(posts).toBe(1);
    await page.unroute(NOTES_PATH);
  });

  test('Save during a held upload does not send a patch', async () => {
    const id = await postNote(page, alpha, ['perro', 'dog']);
    await page.goto(`/notes/${id}`);
    await page.waitForFunction(() => document.body.classList.contains('tui-page'));
    await expect(page.getByLabel('Front')).toHaveValue('perro');
    await page.getByLabel('Front').click();
    const pending = hold();
    let uploads = 0;
    let patches = 0;
    const onRequest = (request: { method: () => string; url: () => string }) => {
      if (request.method() === 'PATCH' && request.url().includes(`/api/notes/${id}`)) {
        patches += 1;
      }
    };
    page.on('request', onRequest);
    await page.route(MEDIA_PATH, async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      uploads += 1;
      await pending.gate;
      await route.continue();
    });
    try {
      await page.getByLabel('Upload').setInputFiles(PNG);
      await expect.poll(() => uploads).toBe(1);
      await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
      await page.getByRole('button', { name: 'Save' }).click({ force: true });
      expect(patches).toBe(0);
    } finally {
      pending.release();
    }
    await expect(page.getByLabel('Front')).toHaveValue(/\{\{media:[0-9a-f]{64}\}\}/);
    expect(patches).toBe(0);
    page.off('request', onRequest);
    await page.unroute(MEDIA_PATH);
  });

  test('a slow preview does not replace a later preview', async () => {
    await openNewNote(page, alpha);
    const pending = hold();
    let held = false;
    await page.route(PREVIEW_PATH, async (route) => {
      if (fieldText(route) === 'SLOW-mark') {
        held = true;
        await pending.gate;
      }
      await route.continue();
    });
    try {
      await page.getByLabel('Front').fill('SLOW-mark');
      await expect.poll(() => held).toBe(true);
      await page.getByLabel('Front').fill('FAST-mark');
      await expect(page.locator('.note-preview')).toContainText('FAST-mark');
      await expect(page.locator('.note-preview')).not.toContainText('SLOW-mark');
      const slowDone = page.waitForResponse((response) => {
        const data = response.request().postData() ?? '';
        return response.url().includes('/api/notes/preview') && data.includes('SLOW-mark');
      });
      pending.release();
      await slowDone;
      await expect(page.locator('.note-preview')).toContainText('FAST-mark');
      await expect(page.locator('.note-preview')).not.toContainText('SLOW-mark');
    } finally {
      pending.release();
      await page.unroute(PREVIEW_PATH);
    }
  });

  test('a failed preview shows an alert and the next preview clears it', async () => {
    await openNewNote(page, alpha);
    await page.route(PREVIEW_PATH, (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'error' }),
      }),
    );
    await page.getByLabel('Front').fill('broken');
    await expect(page.getByRole('alert')).toHaveText('The preview failed.');
    await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
    await page.unroute(PREVIEW_PATH);
    await page.getByLabel('Front').fill('fixed-preview');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('.note-preview')).toContainText('fixed-preview');
  });

  test('a failed save shows an error and a retry creates one note', async () => {
    await openNewNote(page, alpha);
    await page.getByLabel('Front').fill('retry-save');
    await page.getByLabel('Back').fill('cat');
    let posts = 0;
    await page.route(NOTES_PATH, async (route) => {
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
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status')).toHaveText('The request failed.');
    await expect(page).toHaveURL(/\/notes\/new/);
    await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForURL(/\/notes\/[0-9a-f-]{36}$/i);
    expect(posts).toBe(2);
    await page.reload();
    await expect(page.getByLabel('Front')).toHaveValue('retry-save');
    await page.unroute(NOTES_PATH);
  });

  test('a failed upload shows an error and a retry inserts the token', async () => {
    await openNewNote(page, alpha);
    await page.getByLabel('Front').click();
    let uploads = 0;
    await page.route(MEDIA_PATH, async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      uploads += 1;
      if (uploads === 1) {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'mime_mismatch' }),
        });
        return;
      }
      await route.continue();
    });
    await page.getByLabel('Upload').setInputFiles(PNG);
    await expect(page.getByRole('status')).toHaveText('The request failed.');
    await expect(page.getByLabel('Front')).toHaveValue('');
    await expect(page.getByLabel('Upload')).toBeEnabled();
    await page.getByLabel('Upload').setInputFiles(PNG);
    await expect(page.getByLabel('Front')).toHaveValue(/\{\{media:[0-9a-f]{64}\}\}/);
    expect(uploads).toBe(2);
    await page.unroute(MEDIA_PATH);
  });
});
