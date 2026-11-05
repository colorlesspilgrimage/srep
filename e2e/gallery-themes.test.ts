import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { resetAuthViaCli } from './support/cli';
import { addAuthenticator, enableWebAuthn } from './support/virtual-authenticator';

// Contract: gallery theme checks for a guest and for a signed-in user.
// The production build stores #ffff00 as #ff0. Expand that short form.

function expandHex(value: string): string {
  const match = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(value);
  if (match === null) {
    return value;
  }
  const red = match[1];
  const green = match[2];
  const blue = match[3];
  if (red === undefined || green === undefined || blue === undefined) {
    return value;
  }
  return `#${red}${red}${green}${green}${blue}${blue}`;
}

test.describe.serial('gallery themes', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const setupToken = resetAuthViaCli();
    context = await browser.newContext({
      extraHTTPHeaders: { 'x-forwarded-for': '198.51.100.20' },
    });
    page = await context.newPage();
    const cdp = await enableWebAuthn(page);
    await addAuthenticator(cdp, 'platform');
    await page.goto('/setup');
    await page.getByLabel('Setup token').fill(setupToken);
    await page.getByLabel('Nickname').fill('Themes');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Save these codes now. They are shown once.')).toBeVisible();
  });

  test.afterAll(async () => {
    await context.close();
  });

  async function openGallery(query: string): Promise<void> {
    await page.goto(`/gallery${query}`);
    await page.waitForFunction(() => document.body.classList.contains('tui-page'));
    await expect(page.getByRole('heading', { name: 'Gallery', level: 1 })).toBeVisible();
  }

  async function rootBackground(): Promise<string> {
    return page.locator('.tui-root').evaluate((node) => getComputedStyle(node).backgroundColor);
  }

  async function rootToken(name: string): Promise<string> {
    const value = await page.locator('.tui-root').evaluate((node, tokenName) => {
      return getComputedStyle(node).getPropertyValue(tokenName).trim();
    }, name);
    return expandHex(value);
  }

  test('guest GET /gallery?theme=xai-light returns 303 to setup or login', async ({ request }) => {
    const response = await request.get('/gallery?theme=xai-light', { maxRedirects: 0 });
    expect(response.status()).toBe(303);
    expect(response.headers()['location'] ?? '').toMatch(/\/(setup|login)$/);
  });

  test('xai-light query shows light colors', async () => {
    await openGallery('?theme=xai-light');
    expect(await rootBackground()).toBe('rgb(255, 255, 255)');
    expect(await rootToken('--tui-fg')).toBe('#0a0a0a');
    const status = page.getByRole('contentinfo', { name: 'Status line' });
    await expect(status).toContainText('GALLERY');
    await expect(status).toContainText('xAI Light');
  });

  test('unknown theme query shows xAI Dark', async () => {
    await openGallery('?theme=nope');
    expect(await rootBackground()).toBe('rgb(10, 10, 10)');
    await expect(page.getByRole('heading', { name: 'nope' })).toHaveCount(0);
  });

  test('script theme query is not HTML', async () => {
    await openGallery('');
    const scripts = await page.locator('script').count();
    await openGallery('?theme=%3Cscript%3E');
    expect(await rootBackground()).toBe('rgb(10, 10, 10)');
    expect(await page.locator('script').count()).toBe(scripts);
    await expect(page.locator('body')).not.toContainText('<script>');
  });

  test('legacy solarized-light query migrates to xAI Light', async () => {
    await openGallery('?theme=solarized-light');
    expect(await rootBackground()).toBe('rgb(255, 255, 255)');
    await expect(page.getByRole('contentinfo', { name: 'Status line' })).toContainText('xAI Light');
  });

  test('a High Contrast choice changes colors and a reload clears them', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openGallery('');
    const themes = page.getByRole('listbox', { name: 'Themes' });
    await themes.getByRole('option', { name: 'High Contrast' }).click();
    expect(await rootBackground()).toBe('rgb(0, 0, 0)');
    await expect(page).toHaveURL(/\/gallery$/);
    await page.reload();
    await page.waitForFunction(() => document.body.classList.contains('tui-page'));
    expect(await rootBackground()).toBe('rgb(10, 10, 10)');
  });
});
