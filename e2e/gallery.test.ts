import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { resetAuthViaCli } from './support/cli';
import { addAuthenticator, enableWebAuthn } from './support/virtual-authenticator';

// Contract: gallery checks for a guest and for a signed-in user.

test.describe.serial('gallery shell', () => {
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
    await page.getByLabel('Nickname').fill('Gallery');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Save these codes now. They are shown once.')).toBeVisible();
  });

  test.afterAll(async () => {
    await context.close();
  });

  async function openGallery(width: number, height: number): Promise<void> {
    await page.setViewportSize({ width, height });
    const response = await page.goto('/gallery');
    expect(response?.headers()['cache-control'] ?? '').toContain('no-store');
    await page.waitForFunction(() => document.body.classList.contains('tui-page'));
    await expect(page.getByRole('heading', { name: 'Gallery', level: 1 })).toBeVisible();
  }

  test('guest GET /gallery returns 303 to setup or login', async ({ request }) => {
    const response = await request.get('/gallery', { maxRedirects: 0 });
    expect(response.status()).toBe(303);
    expect(response.headers()['location'] ?? '').toMatch(/\/(setup|login)$/);
  });

  test('signed-in gallery shows the heading, the frame, and GALLERY', async () => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Gallery' }).click();
    await expect(page).toHaveURL(/\/gallery$/);
    await expect(page).toHaveTitle('srep gallery');
    await expect(page.getByRole('heading', { name: 'Gallery', level: 1 })).toBeVisible();
    await expect(page.getByRole('contentinfo', { name: 'Status line' })).toContainText('GALLERY');
    const line = page.locator('.tui-frame-line.tui-only-desktop').first();
    await expect(line).toBeVisible();
  });

  test('1440px shows the specimen list and hides the tab bar', async () => {
    await openGallery(1440, 900);
    await expect(page.getByRole('listbox', { name: 'Specimens' })).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Gallery sections' })).toBeHidden();
    const length = await page
      .locator('.tui-frame-line.tui-only-desktop')
      .first()
      .evaluate((node) => node.textContent?.length ?? 0);
    expect(length).toBe(80);
  });

  test('360px shows the tab bar and does not scroll sideways', async () => {
    await openGallery(360, 800);
    await expect(page.getByRole('tablist', { name: 'Gallery sections' })).toBeVisible();
    await expect(page.getByRole('listbox', { name: 'Specimens' })).toBeHidden();
    const fit = await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth <= root.clientWidth + 1;
    });
    expect(fit).toBe(true);
  });

  test('empty form shows an alert and a value is text', async () => {
    await openGallery(360, 800);
    await page.getByRole('tab', { name: 'Form' }).click();
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByRole('alert')).toHaveText('Enter a value.');
    await page.getByRole('textbox', { name: 'Value' }).fill('<b>x</b>');
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByText('Value: <b>x</b>', { exact: true })).toBeVisible();
    expect(await page.locator('b').count()).toBe(0);
  });

  test('modal closes with Escape and with Close', async () => {
    await openGallery(360, 800);
    await page.getByRole('tab', { name: 'Modal' }).click();
    await page.getByRole('button', { name: 'Open modal' }).click();
    const dialog = page.getByRole('dialog', { name: 'Sample modal' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.locator('#tui-open-modal')).toBeFocused();
    await page.getByRole('button', { name: 'Open modal' }).click();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('#tui-open-modal')).toBeFocused();
  });

  test('ArrowDown moves the sample list and stops on Gamma', async () => {
    await openGallery(1440, 900);
    await page.getByRole('option', { name: 'List', exact: true }).click();
    const list = page.getByRole('listbox', { name: 'Sample list' });
    await list.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('option', { name: 'Beta', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('option', { name: 'Gamma', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('option', { name: 'Gamma', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('login page has no TUI root', async () => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('.tui-root')).toHaveCount(0);
    const narrow = await page.evaluate(() => {
      const body = document.body;
      return {
        maxWidth: getComputedStyle(body).maxWidth,
        hasPageClass: body.classList.contains('tui-page'),
      };
    });
    expect(narrow.hasPageClass).toBe(false);
    expect(narrow.maxWidth).toBe('640px');
  });
});
