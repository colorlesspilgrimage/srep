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

// Contract: gallery key checks. A saved chord is in the first HTML.

const CLIENT_IP = '198.51.100.31';
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
  await page.getByLabel('Nickname').fill('Keys');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Save these codes now. They are shown once.')).toBeVisible();
}

async function headers() {
  const status = await page.request.get('/api/auth/status');
  const { csrfToken }: { csrfToken: string } = await status.json();
  return { origin: E2E_ORIGIN, 'x-srep-csrf': csrfToken, 'content-type': 'application/json' };
}

async function restoreDefault(): Promise<void> {
  const response = await page.request.put('/api/settings/keybinds', {
    headers: await headers(),
    data: DEFAULT_MAP,
  });
  expect(response.status()).toBe(200);
  await context.close();
}

async function openAt(width: number, height: number) {
  await page.setViewportSize({ width, height });
  const response = await page.goto('/gallery');
  await page.waitForFunction(() => document.body.classList.contains('tui-page'));
  await expect(page.getByRole('heading', { name: 'Gallery', level: 1 })).toBeVisible();
  return response;
}

function statusLine() {
  return page.getByRole('contentinfo', { name: 'Status line' });
}

function commands() {
  return page.getByRole('dialog', { name: 'Commands' });
}

async function pressAltK(): Promise<void> {
  await page.keyboard.down('Alt');
  await page.keyboard.press('k');
  await page.keyboard.up('Alt');
}

async function guestPut({ request }: { request: APIRequestContext }): Promise<void> {
  const response = await request.put('/api/settings/keybinds', {
    headers: { 'content-type': 'application/json' },
    data: DEFAULT_MAP,
  });
  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual({ error: 'unauthenticated' });
}

async function defaultHints(): Promise<void> {
  await openAt(1440, 900);
  const line = statusLine();
  await expect(line).toContainText('GALLERY');
  await expect(line).toContainText('Ctrl+K palette');
  await expect(line).toContainText('Esc close');
  await expect(line).toContainText('Phosphor Green');
}

async function openAndClose(): Promise<void> {
  await openAt(1440, 900);
  await page.keyboard.press('Control+k');
  await expect(commands()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(commands()).toBeHidden();
}

async function showSettings(): Promise<void> {
  await openAt(1440, 900);
  await page.keyboard.press('Control+k');
  await expect(commands()).toBeVisible();
  await page.getByRole('textbox', { name: 'Command' }).fill('settings');
  const option = page.getByRole('option', { name: 'Show Settings', exact: true });
  await option.focus();
  await option.press('Enter');
  await expect(commands()).toBeHidden();
  await expect(page.getByRole('button', { name: 'Save theme' })).toBeVisible();
}

async function colonInField(): Promise<void> {
  await openAt(1440, 900);
  await page.getByRole('option', { name: 'Form', exact: true }).click();
  const field = page.getByRole('textbox', { name: 'Value' });
  await field.focus();
  await field.press(':');
  await expect(commands()).toBeHidden();
  await expect(field).toHaveValue(':');
  await page.keyboard.press('Control+k');
  await expect(commands()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(commands()).toBeHidden();
}

async function modalEscape(): Promise<void> {
  await openAt(1440, 900);
  await page.getByRole('option', { name: 'Modal', exact: true }).click();
  await page.getByRole('button', { name: 'Open modal' }).click();
  const sample = page.getByRole('dialog', { name: 'Sample modal' });
  await expect(sample).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(commands()).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(sample).toBeHidden();
}

async function narrowFit(): Promise<void> {
  await openAt(360, 800);
  const fit = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth <= root.clientWidth + 1;
  });
  expect(fit).toBe(true);
}

async function enterFocusedRow(): Promise<void> {
  await openAt(1440, 900);
  await page.keyboard.press('Control+k');
  const field = page.getByRole('textbox', { name: 'Command' });
  await field.fill('show');
  const list = page.getByRole('listbox', { name: 'Commands' });
  await expect(list.getByRole('option')).toHaveCount(5);
  const form = list.getByRole('option', { name: 'Show Form', exact: true });
  await form.focus();
  await expect(form).toBeFocused();
  await form.press('Enter');
  await expect(commands()).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Value' })).toBeVisible();
}

async function openShowRows(): Promise<void> {
  await openAt(1440, 900);
  await page.keyboard.press('Control+k');
  await page.getByRole('textbox', { name: 'Command' }).fill('show');
  await expect(page.getByRole('listbox', { name: 'Commands' }).getByRole('option')).toHaveCount(5);
}

async function arrowDownLeavesPaletteOpen(): Promise<void> {
  await openShowRows();
  await page.keyboard.press('ArrowDown');
  await expect(commands()).toBeVisible();
  await expect(page.getByText('Pane body')).toBeVisible();
}

async function arrowDownThenEnterRunsSecondRow(): Promise<void> {
  await openShowRows();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(commands()).toBeHidden();
  await expect(page.getByRole('listbox', { name: 'Sample list' })).toBeVisible();
}

async function arrowUpMovesBack(): Promise<void> {
  await openShowRows();
  const list = page.getByRole('listbox', { name: 'Commands' });
  await page.keyboard.press('ArrowDown');
  await expect(list.getByRole('option', { name: 'Show List', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(list.getByRole('option', { name: 'Show Panes', exact: true })).toBeFocused();
  await expect(commands()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(commands()).toBeHidden();
  await expect(page.getByText('Pane body')).toBeVisible();
  await expect(page.getByRole('listbox', { name: 'Sample list' })).toBeHidden();
}

async function beginOpenChange(): Promise<void> {
  await openAt(1440, 900);
  await page.getByRole('option', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Change Open palette', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel change' })).toBeFocused();
}

function openChordText() {
  return page.getByText('Open palette Ctrl+K', { exact: true });
}

async function tabLeavesCancel(): Promise<void> {
  await beginOpenChange();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Cancel change' })).not.toBeFocused();
  await expect(page.getByRole('button', { name: 'Save keys' })).toBeFocused();
  await expect(openChordText()).toBeVisible();
}

async function enterActivatesCancel(): Promise<void> {
  await beginOpenChange();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Cancel change' })).toHaveCount(0);
  await expect(openChordText()).toBeVisible();
  await expect(page.getByRole('status', { name: 'Key save status' })).toHaveCount(0);
}

async function spaceActivatesCancel(): Promise<void> {
  await beginOpenChange();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Cancel change' })).toHaveCount(0);
  await expect(openChordText()).toBeVisible();
  await expect(page.getByRole('status', { name: 'Key save status' })).toHaveCount(0);
}

async function escapeRestoresDraft(): Promise<void> {
  await beginOpenChange();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Cancel change' })).toHaveCount(0);
  await expect(openChordText()).toBeVisible();
  await expect(page.getByRole('status', { name: 'Key save status' })).toHaveCount(0);
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('tui-page'));
  await expect(statusLine()).toContainText('Ctrl+K palette');
}

async function saveAltK(): Promise<void> {
  await openAt(1440, 900);
  await page.getByRole('option', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Change Open palette', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel change' })).toBeFocused();
  await pressAltK();
  await page.getByRole('button', { name: 'Save keys' }).click();
  await expect(page.getByRole('status', { name: 'Key save status' })).toHaveText('Saved.');
  await expect(statusLine()).toContainText('Alt+K palette');
  const response = await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('tui-page'));
  const html = (await response?.text()) ?? '';
  expect(html).toContain('Alt+K palette');
  await expect(statusLine()).toContainText('Alt+K palette');
  await page.keyboard.press('Control+k');
  await expect(commands()).toBeHidden();
  await pressAltK();
  await expect(commands()).toBeVisible();
}

test.describe.serial('gallery keys', () => {
  test.beforeAll(signIn);
  test.afterAll(restoreDefault);
  test('guest PUT /api/settings/keybinds returns 401', guestPut);
  test('status line shows Ctrl+K palette, Esc close, and Phosphor Green', defaultHints);
  test('Ctrl+K opens the command palette and Escape closes it', openAndClose);
  test('Show Settings opens the settings pane', showSettings);
  test('Enter runs the focused command when the filter has many rows', enterFocusedRow);
  test('ArrowDown keeps the palette open and runs no command', arrowDownLeavesPaletteOpen);
  test('ArrowDown then Enter runs the second command row', arrowDownThenEnterRunsSecondRow);
  test('ArrowUp moves the command row back', arrowUpMovesBack);
  test('Tab leaves Cancel change and does not store Tab', tabLeavesCancel);
  test('Enter activates Cancel change and keeps the chord', enterActivatesCancel);
  test('Space activates Cancel change and keeps the chord', spaceActivatesCancel);
  test('Escape cancels the key change and does not write', escapeRestoresDraft);
  test('colon does not open the palette from the sample field', colonInField);
  test('the sample modal still closes with Escape', modalEscape);
  test('360px page does not scroll sideways', narrowFit);
  test('saved Alt+K remap survives reload and is in the first HTML', saveAltK);
});
