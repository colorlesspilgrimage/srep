import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  visualGalleryPath,
  visualShotPlan,
  type VisualShot,
} from '../src/lib/client/tui/visual-shots.ts';
import { E2E_ORIGIN, resetAuthViaCli } from './support/cli';
import { addAuthenticator, enableWebAuthn } from './support/virtual-authenticator';

// Contract: one gallery screenshot for each theme at 360px and at 1440px.
// The command palette stays closed. The status line uses the default hints.

const CLIENT_IP = '198.51.100.32';
const DEFAULT_MAP = {
  'palette.open': 'Ctrl+K',
  'palette.open-colon': ':',
  'palette.close': 'Escape',
};

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
  await page.getByLabel('Nickname').fill('Visual');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Save these codes now. They are shown once.')).toBeVisible();
}

async function restoreDefaultKeys(): Promise<void> {
  const status = await page.request.get('/api/auth/status');
  const { csrfToken }: { csrfToken: string } = await status.json();
  const response = await page.request.put('/api/settings/keybinds', {
    headers: {
      origin: E2E_ORIGIN,
      'x-srep-csrf': csrfToken,
      'content-type': 'application/json',
    },
    data: DEFAULT_MAP,
  });
  expect(response.status()).toBe(200);
}

async function prepare({ browser }: { browser: Browser }): Promise<void> {
  await signIn({ browser });
  await restoreDefaultKeys();
}

async function closeContext(): Promise<void> {
  await context.close();
}

async function expectClosedPalette(themeName: string): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Gallery', level: 1 })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Commands' })).toBeHidden();
  const line = page.getByRole('contentinfo', { name: 'Status line' });
  await expect(line).toContainText('GALLERY');
  await expect(line).toContainText('Ctrl+K palette');
  await expect(line).toContainText('Esc close');
  await expect(line).toContainText(themeName);
}

async function shoot(item: VisualShot): Promise<void> {
  const height = item.width === 360 ? 800 : 900;
  await page.setViewportSize({ width: item.width, height });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(visualGalleryPath(item.id));
  await page.waitForFunction(() => document.body.classList.contains('tui-page'));
  await expectClosedPalette(item.themeName);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('.tui-root')).toHaveScreenshot(item.file, {
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
    maxDiffPixelRatio: 0,
  });
}

test.describe.serial('gallery visual', () => {
  test.beforeAll(prepare);
  test.afterAll(closeContext);

  for (const item of visualShotPlan()) {
    test(`${item.id} at ${item.width}`, () => shoot(item));
  }
});
