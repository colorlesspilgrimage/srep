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
    data: { id: 'phosphor-green' },
  });
  expect(response.status()).toBe(200);
  await context.close();
}

async function openGallery(query: string): Promise<string> {
  const response = await page.goto(`/gallery${query}`);
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
    data: { id: 'nord' },
  });
  expect(response.status()).toBe(401);
}

async function missingCsrf(): Promise<void> {
  const response = await page.request.put('/api/settings/theme', {
    headers: { origin: E2E_ORIGIN, 'content-type': 'application/json' },
    data: { id: 'nord' },
  });
  expect(response.status()).toBe(403);
}

async function opensGreen(): Promise<void> {
  await openGallery('');
  expect(await rootBackground()).toBe('rgb(0, 26, 0)');
}

async function previewNord(): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGallery('');
  await page.getByRole('option', { name: 'Settings', exact: true }).click();
  await chooseOption('Theme setting', 'Nord');
  expect(await rootBackground()).toBe('rgb(46, 52, 64)');
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('tui-page'));
  expect(await rootBackground()).toBe('rgb(0, 26, 0)');
}

async function saveNord(): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGallery('');
  await page.getByRole('option', { name: 'Settings', exact: true }).click();
  await chooseOption('Theme setting', 'Nord');
  await page.getByRole('button', { name: 'Save theme' }).click();
  await expect(page.getByRole('status', { name: 'Theme save status' })).toHaveText('Saved.');
  const html = await openGallery('');
  expect(html).toContain('tui-root tui-theme-nord');
  expect(await rootBackground()).toBe('rgb(46, 52, 64)');
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
    expect(background).toBe('rgb(46, 52, 64)');
  } finally {
    await plain.close();
  }
}

async function queryDoesNotSave(): Promise<void> {
  await openGallery('?theme=solarized-light');
  expect(await rootBackground()).toBe('rgb(253, 246, 227)');
  await openGallery('');
  expect(await rootBackground()).toBe('rgb(46, 52, 64)');
}

async function themesListDoesNotSave(): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGallery('');
  await chooseOption('Themes', 'Tokyo Night');
  expect(await rootBackground()).toBe('rgb(26, 27, 38)');
  await expect(page).toHaveURL(/\/gallery$/);
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('tui-page'));
  expect(await rootBackground()).toBe('rgb(46, 52, 64)');
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
}

test.describe.serial('gallery settings', () => {
  test.beforeAll(signIn);
  test.afterAll(restoreGreen);
  test('guest PUT /api/settings/theme returns 401', guestPut);
  test('signed-in PUT without x-srep-csrf returns 403', missingCsrf);
  test('gallery opens with Phosphor Green', opensGreen);
  test('Nord preview changes colors and a reload restores Phosphor Green', previewNord);
  test('Save theme keeps Nord after reload', saveNord);
  test('JavaScript off still shows the saved theme', javaScriptOff);
  test('a theme query does not change the saved theme', queryDoesNotSave);
  test('the Themes list does not save Tokyo Night', themesListDoesNotSave);
  test('360px page does not scroll sideways and shows the Settings tab', narrowFit);
});
