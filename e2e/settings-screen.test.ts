import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { E2E_ORIGIN, resetAuthViaCli } from './support/cli';
import { addAuthenticator, enableWebAuthn } from './support/virtual-authenticator';

// Contract: Settings Appearance, Display, Study day, and Presets. Prefs persist across reload.

const CLIENT_IP = '198.51.100.47';
const DEFAULT_MAP = {
  'palette.open': 'Ctrl+K',
  'palette.open-colon': ':',
  'palette.close': 'Escape',
};

let context: BrowserContext;
let page: Page;

async function signIn(browser: Browser): Promise<void> {
  const setupToken = resetAuthViaCli();
  context = await browser.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': CLIENT_IP },
    viewport: { width: 1440, height: 900 },
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

async function restoreDefaults(): Promise<void> {
  const theme = await page.request.put('/api/settings/theme', {
    headers: await headers(),
    data: { id: 'xai-dark' },
  });
  expect(theme.status()).toBe(200);
  const keys = await page.request.put('/api/settings/keybinds', {
    headers: await headers(),
    data: DEFAULT_MAP,
  });
  expect(keys.status()).toBe(200);
  const study = await page.request.put('/api/settings/study', {
    headers: await headers(),
    data: { rolloverHour: 4, timezone: 'UTC' },
  });
  expect(study.status()).toBe(200);
  const display = await page.request.put('/api/settings/display', {
    headers: await headers(),
    data: {
      fontSize: 16,
      reducedMotion: false,
      scanline: false,
      cursorBlink: false,
    },
  });
  expect(display.status()).toBe(200);
  await context.close();
}

async function openSettings(): Promise<void> {
  await page.goto('/settings');
  await page.waitForFunction(() => document.body.classList.contains('tui-page'));
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
}

async function chooseOption(listName: string, optionName: string): Promise<void> {
  await page
    .getByRole('listbox', { name: listName })
    .getByRole('option', { name: optionName })
    .click();
}

async function pressAltK(): Promise<void> {
  await page.keyboard.down('Alt');
  await page.keyboard.press('k');
  await page.keyboard.up('Alt');
}

function statusLine() {
  return page.getByRole('contentinfo', { name: 'Status line' });
}

function commands() {
  return page.getByRole('dialog', { name: 'Commands' });
}

test('guest GET /settings returns 303 to setup or login', async ({ request }) => {
  const response = await request.get('/settings', {
    maxRedirects: 0,
    headers: { 'x-forwarded-for': CLIENT_IP },
  });
  expect(response.status()).toBe(303);
  expect(response.headers().location).toMatch(/\/(setup|login)$/);
});

test.describe.serial('settings screen', () => {
  test.beforeAll(async ({ browser }) => {
    await signIn(browser);
  });

  test.afterAll(async () => {
    await restoreDefaults();
  });

  test('opens Settings tab', async () => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/');
    await page.waitForFunction(() => document.body.classList.contains('tui-page'));
    await expect(page.getByRole('tab', { name: 'Settings' })).toBeVisible();
    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    await expect(page.getByRole('listbox', { name: 'Settings sections' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Appearance' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save theme' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save keys' })).toBeVisible();
  });

  test('Save theme keeps xAI Light after reload', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSettings();
    await chooseOption('Theme setting', 'xAI Light');
    await page.getByRole('button', { name: 'Save theme' }).click();
    await expect(page.getByRole('status', { name: 'Saved.' })).toHaveText('Saved.');
    const response = await page.reload();
    await page.waitForFunction(() => document.body.classList.contains('tui-page'));
    const html = (await response?.text()) ?? '';
    expect(html).toContain('tui-root app-root tui-theme-xai-light');
    expect(
      await page.locator('.tui-root').evaluate((node) => getComputedStyle(node).backgroundColor),
    ).toBe('rgb(255, 255, 255)');
  });

  test('Save keys remaps Open palette to Alt+K', async () => {
    await openSettings();
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
    await page.keyboard.press('Escape');
    await expect(commands()).toBeHidden();
  });

  test('Save study day keeps timezone and rollover after reload', async () => {
    await openSettings();
    await chooseOption('Settings sections', 'Study day');
    await expect(page.getByRole('tabpanel', { name: 'Study day' })).toBeVisible();
    await page.getByLabel('Timezone').fill('Europe/Berlin');
    await page.getByLabel('Rollover hour').fill('6');
    await page.getByRole('button', { name: 'Save study day' }).click();
    await expect(page.getByRole('status', { name: 'Study day status' })).toHaveText('Saved.');
    await page.reload();
    await page.waitForFunction(() => document.body.classList.contains('tui-page'));
    await chooseOption('Settings sections', 'Study day');
    await expect(page.getByLabel('Timezone')).toHaveValue('Europe/Berlin');
    await expect(page.getByLabel('Rollover hour')).toHaveValue('6');
    const read = await page.request.get('/api/settings/study');
    expect(await read.json()).toEqual({
      settings: { rolloverHour: 6, timezone: 'Europe/Berlin' },
    });
  });

  test('Save display keeps font size and reduced motion after reload', async () => {
    await openSettings();
    await chooseOption('Settings sections', 'Display');
    await expect(page.getByRole('tabpanel', { name: 'Display' })).toBeVisible();
    await page.getByLabel('Font size').fill('18');
    await page.getByLabel('Reduced motion').check();
    await page.getByRole('button', { name: 'Save display' }).click();
    await expect(page.getByRole('status', { name: 'Display status' })).toHaveText('Saved.');
    const response = await page.reload();
    await page.waitForFunction(() => document.body.classList.contains('tui-page'));
    const html = (await response?.text()) ?? '';
    expect(html).toContain('tui-font-18');
    expect(html).toContain('tui-display-reduced-motion');
    expect(html).not.toContain('tui-display-scanline');
    expect(html).not.toContain('tui-display-cursor-blink');
    await chooseOption('Settings sections', 'Display');
    await expect(page.getByLabel('Font size')).toHaveValue('18');
    await expect(page.getByLabel('Reduced motion')).toBeChecked();
    await expect(page.getByLabel('Scanline')).toHaveCount(0);
    await expect(page.getByLabel('Cursor blink')).toHaveCount(0);
    const read = await page.request.get('/api/settings/display');
    expect(await read.json()).toEqual({
      display: {
        fontSize: 18,
        reducedMotion: true,
        scanline: false,
        cursorBlink: false,
      },
    });
  });

  test('create and edit a preset; block delete of default', async () => {
    const created = `E2E preset ${Date.now()}`;
    const renamed = `${created} edit`;
    await openSettings();
    await chooseOption('Settings sections', 'Presets');
    await expect(page.getByRole('tabpanel', { name: 'Presets' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Default', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'New preset' }).click();
    await page.getByLabel('Name', { exact: true }).fill(created);
    await page.getByLabel('New per day').fill('5');
    await page.getByLabel('Reviews per day').fill('50');
    await page.getByRole('button', { name: 'Save preset' }).click();
    await expect(page.getByRole('status', { name: 'Presets status' })).toHaveText('Saved.');
    await expect(page.getByRole('option', { name: created, exact: true })).toBeVisible();
    await expect(page.getByLabel('New per day')).toHaveValue('5');
    await page.getByLabel('Name', { exact: true }).fill(renamed);
    await page.getByLabel('New per day').fill('8');
    await page.getByRole('button', { name: 'Save preset' }).click();
    await expect(page.getByRole('status', { name: 'Presets status' })).toHaveText('Saved.');
    await expect(page.getByRole('option', { name: renamed, exact: true })).toBeVisible();
    await expect(page.getByLabel('New per day')).toHaveValue('8');
    await chooseOption('Presets', 'Default');
    await page.getByRole('button', { name: 'Delete preset' }).click();
    await expect(page.getByRole('status', { name: 'Presets status' })).toHaveText(
      'The default preset cannot be deleted.',
    );
    const listed = await page.request.get('/api/presets');
    const body = (await listed.json()) as { presets: { name: string; id: string }[] };
    expect(body.presets.map((preset) => preset.name)).toEqual(
      expect.arrayContaining(['Default', renamed]),
    );
    const row = body.presets.find((preset) => preset.name === renamed);
    expect(row).toBeDefined();
    if (row !== undefined) {
      const del = await page.request.delete(`/api/presets/${row.id}`, {
        headers: await headers(),
      });
      expect(del.status()).toBe(200);
    }
  });

  test('Security section lists credentials and recovery count', async () => {
    await page.goto('/security');
    await page.waitForFunction(() => document.body.classList.contains('tui-page'));
    await expect(page).toHaveURL(/\/settings\?section=security$/);
    await expect(page.getByRole('tabpanel', { name: 'Security' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Credentials' })).toContainText('Settings');
    await expect(page.getByRole('status', { name: 'Recovery codes' })).toHaveText(
      'Unused recovery codes: 10',
    );
    await expect(page.getByRole('button', { name: 'Log out', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log out everywhere' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add a passkey' })).toBeVisible();
  });

  test('trash list restores a note', async () => {
    const decks = await page.request.get('/api/decks');
    const deckBody = (await decks.json()) as { decks: { id: string; name: string }[] };
    let deckId = deckBody.decks[0]?.id;
    if (deckId === undefined) {
      const created = await page.request.post('/api/decks', {
        headers: await headers(),
        data: { name: `Trash deck ${Date.now()}` },
      });
      expect(created.status()).toBe(201);
      deckId = ((await created.json()) as { deck: { id: string } }).deck.id;
    }
    const types = await page.request.get('/api/note-types');
    const typeBody = (await types.json()) as { noteTypes: { id: string; name: string }[] };
    const basic = typeBody.noteTypes.find((row) => row.name === 'Basic');
    expect(basic).toBeDefined();
    const preview = `Trash e2e ${Date.now()}`;
    const noteRes = await page.request.post('/api/notes', {
      headers: await headers(),
      data: {
        noteTypeId: basic?.id,
        deckId,
        fields: [preview, 'back'],
        tags: [],
      },
    });
    expect(noteRes.status()).toBe(201);
    const noteId = ((await noteRes.json()) as { note: { id: string } }).note.id;
    const trashed = await page.request.delete(`/api/notes/${noteId}`, {
      headers: await headers(),
    });
    expect(trashed.status()).toBe(200);
    await openSettings();
    await chooseOption('Settings sections', 'Data');
    await expect(page.getByRole('tabpanel', { name: 'Data' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Trashed notes' })).toBeVisible();
    await expect(page.getByText(preview)).toBeVisible();
    await page.getByRole('button', { name: `Restore ${preview}` }).click();
    await expect(page.getByRole('status', { name: 'Data status' })).toHaveText('Restored.');
    // Other e2e files may leave trashed notes in the shared DB; assert this note left trash.
    await expect(page.getByRole('button', { name: `Restore ${preview}` })).toHaveCount(0);
    await expect(page.getByText('Anki import and export ship in M6.')).toBeVisible();
    const live = await page.request.get(`/api/notes/${noteId}`);
    expect(live.status()).toBe(200);
    expect(
      ((await live.json()) as { note: { deletedAt: number | null } }).note.deletedAt,
    ).toBeNull();
  });
});
