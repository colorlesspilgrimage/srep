import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { E2E_ORIGIN, resetAuthViaCli } from './support/cli';
import { addAuthenticator, enableWebAuthn } from './support/virtual-authenticator';

// Contract: gallery settings checks. A saved theme is in the first HTML.

const CLIENT_IP = '198.51.100.30';

let context: BrowserContext;
let page: Page;

async function signIn({ browser }: { browser: Browser }): Promise<void> {
  const setupToken = resetAuthViaCli();
  context = await browser.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': CLIENT_IP },
  });
  page = await context.newPage();
  const cdp = await enableWebAuthn(page);
  await addAuthenticator(cdp, 'platform');
  await page.goto('/setup');
  await page.getByLabel('Setup token').fill(setupToken);
  await page.getByLabel('Nickname').fill('Settings');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Save these codes now. They are shown once.')).toBeVisible();
}

async function headers() {
  const status = await page.request.get('/api/auth/status');
  const { csrfToken }: { csrfToken: string } = await status.json();
  return { origin: E2E_ORIGIN, 'x-srep-csrf': csrfToken, 'content-type': 'application/json' };
}

async function restoreGreen(): Promise<void> {
  const response = await page.request.put('/api/settings/theme', {
    headers: await headers(),
    data: { id: 'xai-dark' },
  });
  expect(response.status()).toBe(200);
  await context.close();
}

function expectDocumentHeaders(response: { headers(): Record<string, string> } | null): void {
  const headers = response?.headers() ?? {};
  expect(headers['cache-control'] ?? '').toContain('no-store');
  expect((headers['vary'] ?? '').toLowerCase()).toContain('cookie');
  const csp = headers['content-security-policy'] ?? '';
  expect(csp).toContain("'nonce-");
  expect(csp).toContain("style-src 'self'");
  expect(csp).not.toContain("'unsafe-inline'");
}

async function openGallery(query: string): Promise<string> {
  const response = await page.goto(`/gallery${query}`);
  expectDocumentHeaders(response);
  await page.waitForFunction(() => document.body.classList.contains('tui-page'));
  await expect(page.getByRole('heading', { name: 'Gallery', level: 1 })).toBeVisible();
  return response?.text() ?? '';
}

async function rootBackground(): Promise<string> {
  return page.locator('.tui-root').evaluate((node) => getComputedStyle(node).backgroundColor);
}

async function chooseOption(listName: string, optionName: string): Promise<void> {
  await page
    .getByRole('listbox', { name: listName })
    .getByRole('option', { name: optionName })
    .click();
}

async function guestPut({ request }: { request: APIRequestContext }): Promise<void> {
  const response = await request.put('/api/settings/theme', {
    headers: { 'content-type': 'application/json' },
    data: { id: 'xai-light' },
  });
  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual({ error: 'unauthenticated' });
}

async function missingCsrf(): Promise<void> {
  const response = await page.request.put('/api/settings/theme', {
    headers: { origin: E2E_ORIGIN, 'content-type': 'application/json' },
    data: { id: 'xai-light' },
  });
  expect(response.status()).toBe(403);
  expect(await response.json()).toEqual({ error: 'bad_csrf' });
}

async function opensGreen(): Promise<void> {
  await openGallery('');
  expect(await rootBackground()).toBe('rgb(10, 10, 10)');
}

async function previewNord(): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGallery('');
  await page.getByRole('option', { name: 'Settings', exact: true }).click();
  await chooseOption('Theme setting', 'xAI Light');
  expect(await rootBackground()).toBe('rgb(255, 255, 255)');
  const reloaded = await page.reload();
  expectDocumentHeaders(reloaded);
  await page.waitForFunction(() => document.body.classList.contains('tui-page'));
  expect(await rootBackground()).toBe('rgb(10, 10, 10)');
}

async function saveNord(): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGallery('');
  await page.getByRole('option', { name: 'Settings', exact: true }).click();
  await chooseOption('Theme setting', 'xAI Light');
  await page.getByRole('button', { name: 'Save theme' }).click();
  await expect(page.getByRole('status', { name: 'Saved.' })).toHaveText('Saved.');
  const html = await openGallery('');
  expect(html).toContain('tui-root tui-theme-xai-light');
  expect(html).not.toMatch(/tui-theme-xai-light[^>]*style=/);
  expect(html).not.toContain('tui-theme-<');
  expect(await rootBackground()).toBe('rgb(255, 255, 255)');
}

async function javaScriptOff({ browser }: { browser: Browser }): Promise<void> {
  const state = await context.storageState();
  const plain = await browser.newContext({
    javaScriptEnabled: false,
    storageState: state,
    extraHTTPHeaders: { 'x-forwarded-for': CLIENT_IP },
  });
  const plainPage = await plain.newPage();
  try {
    await plainPage.goto('/gallery');
    const background = await plainPage
      .locator('.tui-root')
      .evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(background).toBe('rgb(255, 255, 255)');
  } finally {
    await plain.close();
  }
}

async function queryDoesNotSave(): Promise<void> {
  await openGallery('?theme=xai-light');
  expect(await rootBackground()).toBe('rgb(255, 255, 255)');
  await openGallery('');
  expect(await rootBackground()).toBe('rgb(255, 255, 255)');
}

async function themesListDoesNotSave(): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGallery('');
  await chooseOption('Themes', 'High Contrast');
  expect(await rootBackground()).toBe('rgb(0, 0, 0)');
  await expect(page).toHaveURL(/\/gallery$/);
  const reloaded = await page.reload();
  expectDocumentHeaders(reloaded);
  await page.waitForFunction(() => document.body.classList.contains('tui-page'));
  expect(await rootBackground()).toBe('rgb(255, 255, 255)');
  await expect(page).toHaveURL(/\/gallery$/);
}

async function narrowFit(): Promise<void> {
  await page.setViewportSize({ width: 360, height: 800 });
  await openGallery('');
  const fit = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth <= root.clientWidth + 1;
  });
  expect(fit).toBe(true);
  await expect(page.getByRole('tab', { name: 'Settings' })).toBeVisible();
  await page.getByRole('tab', { name: 'Settings' }).click();
  const box = await page.getByRole('button', { name: 'Save theme' }).boundingBox();
  expect(box).not.toBeNull();
  expect(box?.height).toBeGreaterThanOrEqual(24);
  expect(box?.width).toBeGreaterThanOrEqual(24);
}

async function keyboardPreview(): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGallery('');
  await page.getByRole('option', { name: 'Settings', exact: true }).click();
  const list = page.getByRole('listbox', { name: 'Theme setting' });
  await list.focus();
  await list.press('ArrowDown');
  expect(await rootBackground()).toBe('rgb(255, 255, 255)');
  const button = page.getByRole('button', { name: 'Save theme' });
  const box = await button.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.height).toBeGreaterThanOrEqual(24);
  expect(box?.width).toBeGreaterThanOrEqual(24);
  await button.focus();
  const outline = await button.evaluate((node) => getComputedStyle(node).outlineStyle);
  expect(outline).not.toBe('none');
  const reloaded = await page.reload();
  expectDocumentHeaders(reloaded);
  await page.waitForFunction(() => document.body.classList.contains('tui-page'));
  expect(await rootBackground()).toBe('rgb(10, 10, 10)');
}

async function choiceClearsSavedStatus(): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGallery('');
  await page.getByRole('option', { name: 'Settings', exact: true }).click();
  await chooseOption('Theme setting', 'xAI Light');
  await page.getByRole('button', { name: 'Save theme' }).click();
  await expect(page.getByRole('status', { name: 'Saved.' })).toHaveText('Saved.');
  await chooseOption('Theme setting', 'High Contrast');
  await expect(page.getByRole('status')).toHaveText('');
  expect(await rootBackground()).toBe('rgb(0, 0, 0)');
  const reloaded = await page.reload();
  expectDocumentHeaders(reloaded);
  await page.waitForFunction(() => document.body.classList.contains('tui-page'));
  expect(await rootBackground()).toBe('rgb(255, 255, 255)');
}

test.describe.serial('gallery settings', () => {
  test.beforeAll(signIn);
  test.afterAll(restoreGreen);
  test('guest PUT /api/settings/theme returns 401', guestPut);
  test('signed-in PUT without x-srep-csrf returns 403', missingCsrf);
  test('gallery opens with xAI Dark', opensGreen);
  test('ArrowDown previews the next theme and does not save it', keyboardPreview);
  test('xAI Light preview changes colors and a reload restores xAI Dark', previewNord);
  test('Save theme keeps xAI Light after reload', saveNord);
  test('a new choice clears the saved status and does not write', choiceClearsSavedStatus);
  test('JavaScript off still shows the saved theme', javaScriptOff);
  test('a theme query does not change the saved theme', queryDoesNotSave);
  test('the Themes list does not save High Contrast', themesListDoesNotSave);
  test('360px page does not scroll sideways and shows the Settings tab', narrowFit);
});
