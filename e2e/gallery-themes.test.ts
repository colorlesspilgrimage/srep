import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { resetAuthViaCli } from './support/cli';
import { addAuthenticator, enableWebAuthn } from './support/virtual-authenticator';

// Contract: gallery theme checks for a guest and for a signed-in user.

test.describe.serial('gallery themes', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const setupToken = resetAuthViaCli();
    context = await browser.newContext();
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
    return page.locator('.tui-root').evaluate((node, tokenName) => {
      return getComputedStyle(node).getPropertyValue(tokenName).trim();
    }, name);
  }

  test('guest GET /gallery?theme=nord returns 303 to setup or login', async ({ request }) => {
    const response = await request.get('/gallery?theme=nord', { maxRedirects: 0 });
    expect(response.status()).toBe(303);
    expect(response.headers()['location'] ?? '').toMatch(/\/(setup|login)$/);
  });

  test('nord query shows Nord colors and the status name', async () => {
    await openGallery('?theme=nord');
    expect(await rootBackground()).toBe('rgb(46, 52, 64)');
    expect(await rootToken('--tui-fg')).toBe('#d8dee9');
    const status = page.getByRole('contentinfo', { name: 'Status line' });
    await expect(status).toContainText('GALLERY');
    await expect(status).toContainText('Nord');
  });

  test('unknown theme query shows Phosphor Green', async () => {
    await openGallery('?theme=nope');
    expect(await rootBackground()).toBe('rgb(0, 26, 0)');
    await expect(page.getByRole('heading', { name: 'nope' })).toHaveCount(0);
  });

  test('script theme query is not HTML', async () => {
    await openGallery('');
    const scripts = await page.locator('script').count();
    await openGallery('?theme=%3Cscript%3E');
    expect(await rootBackground()).toBe('rgb(0, 26, 0)');
    expect(await page.locator('script').count()).toBe(scripts);
    await expect(page.locator('body')).not.toContainText('<script>');
  });

  test('solarized-light query shows the light background', async () => {
    await openGallery('?theme=solarized-light');
    expect(await rootBackground()).toBe('rgb(253, 246, 227)');
    await expect(page.getByRole('contentinfo', { name: 'Status line' })).toContainText(
      'Solarized Light',
    );
  });

  test('a Tokyo Night choice changes colors and a reload clears them', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openGallery('');
    const themes = page.getByRole('listbox', { name: 'Themes' });
    await themes.getByRole('option', { name: 'Tokyo Night' }).click();
    expect(await rootBackground()).toBe('rgb(26, 27, 38)');
    await expect(page).toHaveURL(/\/gallery$/);
    await page.reload();
    await page.waitForFunction(() => document.body.classList.contains('tui-page'));
    expect(await rootBackground()).toBe('rgb(0, 26, 0)');
  });

  test('360px page does not scroll sideways and shows VT100 White-on-Black', async () => {
    await page.setViewportSize({ width: 360, height: 800 });
    await openGallery('');
    const fit = await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth <= root.clientWidth + 1;
    });
    expect(fit).toBe(true);
    await expect(page.getByRole('option', { name: 'VT100 White-on-Black' })).toBeVisible();
  });

  test('high-contrast query sets the accent token', async () => {
    await openGallery('?theme=high-contrast');
    expect(await rootToken('--tui-accent')).toBe('#ffff00');
  });
});
