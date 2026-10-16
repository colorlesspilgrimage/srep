import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { E2E_ORIGIN, resetAuthViaCli } from './support/cli';
import { addAuthenticator, enableWebAuthn } from './support/virtual-authenticator';

// Contract: deck list keys and counts. Tree keys use page.keyboard on three rows.
// Domain rows stay across runs. This file uses fixed names, so it deletes root decks first.

const CLIENT_IP = '198.51.100.40';
const BASIC_ID = '00000000-0000-4000-8000-000000000011';

let context: BrowserContext;
let page: Page;

function row(name: string) {
  return page.getByRole('treeitem', { name: new RegExp(`^${name}\\b`) });
}

function selected() {
  return page.getByRole('treeitem', { selected: true });
}

function commands() {
  return page.getByRole('dialog', { name: 'Commands' });
}

function deleteDialog() {
  return page.getByRole('dialog', { name: /^Delete / });
}

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
  await page.getByLabel('Nickname').fill('Decks');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Save these codes now. They are shown once.')).toBeVisible();
  await removeRootDecks();
}

async function removeRootDecks(): Promise<void> {
  const listed = await page.request.get('/api/decks');
  const body: { decks: { id: string; name: string; parentId: string | null }[] } =
    await listed.json();
  const roots = body.decks.filter((deck) => deck.parentId === null);
  if (roots.length === 0) {
    return;
  }
  const status = await page.request.get('/api/auth/status');
  const { csrfToken }: { csrfToken: string } = await status.json();
  for (const deck of roots) {
    const response = await page.request.delete(`/api/decks/${deck.id}`, {
      headers: {
        origin: E2E_ORIGIN,
        'x-srep-csrf': csrfToken,
        'content-type': 'application/json',
      },
      data: { action: 'trash' },
    });
    expect(response.ok()).toBeTruthy();
  }
}

async function openHome(): Promise<void> {
  const response = await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('tui-page'));
  expect(response?.headers()['cache-control']).toBe('no-store');
  await expect(page.getByRole('heading', { name: 'srep', level: 1 })).toBeVisible();
  await expect(page.locator('.tui-theme-phosphor-green')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create root' })).toBeEnabled();
}

async function createRoot(name: string): Promise<void> {
  await page.getByLabel('Deck name').fill(name);
  await page.getByRole('button', { name: 'Create root' }).click();
  await expect(row(name)).toBeVisible();
}

async function createChild(parent: string, name: string): Promise<void> {
  await row(parent).click();
  await expect(page.getByLabel('Deck name')).toHaveValue(parent);
  await page.getByLabel('Deck name').fill(name);
  await page.getByRole('button', { name: 'Create child' }).click();
  await expect(row(name)).toBeVisible();
}

async function focusTree(): Promise<void> {
  await page.getByRole('tree', { name: 'Decks' }).click();
}

async function expandRoot(): Promise<void> {
  await focusTree();
  await page.keyboard.press('Home');
  await page.keyboard.press('l');
  await expect(page.getByRole('treeitem')).toHaveCount(3);
}

test('guest GET / returns 303 to setup or login', async ({ request }) => {
  const response = await request.get('/', {
    maxRedirects: 0,
    headers: { 'x-forwarded-for': CLIENT_IP },
  });
  expect(response.status()).toBe(303);
  expect(response.headers().location).toMatch(/\/(setup|login)$/);
});

test.describe.serial('deck list', () => {
  test.beforeAll(async ({ browser }) => {
    await signIn(browser);
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('a signed-in user creates three decks', async () => {
    await openHome();
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
    await createRoot('Languages');
    await createChild('Languages', 'Spanish');
    await createChild('Languages', 'French');
    const rows = page.getByRole('treeitem');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Languages');
    await expect(rows.nth(1)).toContainText('French');
    await expect(rows.nth(2)).toContainText('Spanish');
  });

  test('tree keys move, expand, and leave the row alone', async () => {
    await focusTree();
    await page.keyboard.press('Home');
    await expect(selected()).toContainText('Languages');
    await expect(page.getByRole('tree', { name: 'Decks' })).toHaveAttribute(
      'aria-activedescendant',
      /^deck-row-[0-9a-f-]{36}$/i,
    );
    await page.keyboard.press('ArrowDown');
    await expect(selected()).toContainText('French');
    await page.keyboard.press('ArrowDown');
    await expect(selected()).toContainText('Spanish');
    await page.keyboard.press('ArrowDown');
    await expect(selected()).toContainText('Spanish');
    await page.keyboard.press('ArrowUp');
    await expect(selected()).toContainText('French');
    await page.keyboard.press('ArrowUp');
    await expect(selected()).toContainText('Languages');
    await page.keyboard.press('ArrowUp');
    await expect(selected()).toContainText('Languages');
    await page.keyboard.press('j');
    await expect(selected()).toContainText('French');
    await page.keyboard.press('k');
    await expect(selected()).toContainText('Languages');
    await page.keyboard.press('End');
    await expect(selected()).toContainText('Spanish');
    await page.keyboard.press('Home');
    await expect(selected()).toContainText('Languages');
    await page.keyboard.press('ArrowRight');
    await expect(selected()).toContainText('French');
    await page.keyboard.press('ArrowLeft');
    await expect(selected()).toContainText('Languages');
    await page.keyboard.press('h');
    await expect(page.getByRole('treeitem')).toHaveCount(1);
    await page.keyboard.press('ArrowLeft');
    await expect(selected()).toContainText('Languages');
    await page.keyboard.press('l');
    await expect(page.getByRole('treeitem')).toHaveCount(3);
    await page.keyboard.press('Home');
    for (const key of [
      ' ',
      '1',
      '2',
      '3',
      '4',
      'Escape',
      'Delete',
      'Backspace',
      'PageUp',
      'PageDown',
    ]) {
      await page.keyboard.press(key);
      await expect(selected()).toContainText('Languages');
    }
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Deck name')).toBeFocused();
    await expect(selected()).toContainText('Languages');
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('tree', { name: 'Decks' })).toBeFocused();
    await page.keyboard.press('Control+k');
    await expect(commands()).toBeVisible();
    await expect(selected()).toContainText('Languages');
    await page.keyboard.press('Escape');
    await expect(commands()).toBeHidden();
    await page.keyboard.press(':');
    await expect(commands()).toBeVisible();
    await expect(selected()).toContainText('Languages');
    await page.keyboard.press('Escape');
    await expect(commands()).toBeHidden();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Deck name')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Deck name')).not.toBeFocused();
    await expect(selected()).toContainText('Languages');
  });

  test('a parent New count includes the child decks', async () => {
    const response = await page.request.get('/api/decks');
    const body: { decks: { id: string; name: string }[] } = await response.json();
    const spanish = body.decks.find((deck) => deck.name === 'Spanish');
    expect(spanish).toBeTruthy();
    const status = await page.request.get('/api/auth/status');
    const { csrfToken }: { csrfToken: string } = await status.json();
    const note = await page.request.post('/api/notes', {
      headers: { origin: E2E_ORIGIN, 'x-srep-csrf': csrfToken, 'content-type': 'application/json' },
      data: { noteTypeId: BASIC_ID, deckId: spanish?.id, fields: ['hola', 'hello'], tags: [] },
    });
    expect(note.status()).toBe(201);
    await openHome();
    await expandRoot();
    await expect(row('Languages')).toContainText('New 1');
    await expect(row('French')).toContainText('New 0');
    await expect(row('Spanish')).toContainText('New 1');
    await expect(row('Languages')).toContainText('Learning 0');
    await expect(row('Languages')).toContainText('Due 0');
  });

  test('field keys do not move the tree, and Enter renames', async () => {
    await focusTree();
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    const field = page.getByLabel('Deck name');
    await expect(field).toBeFocused();
    await page.keyboard.press('j');
    await page.keyboard.press('k');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    for (const key of ['1', '2', '3', '4']) {
      await page.keyboard.press(key);
    }
    await expect(selected()).toContainText('Languages');
    await expect(commands()).toBeHidden();
    await page.keyboard.press(':');
    await expect(commands()).toBeHidden();
    await expect(field).toHaveValue(/:/);
    await page.keyboard.press('Control+k');
    await expect(commands()).toBeVisible();
    await expect(selected()).toContainText('Languages');
    await page.keyboard.press('Escape');
    await expect(commands()).toBeHidden();
    await expect(field).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(field).not.toBeFocused();
    await expect(selected()).toContainText('Languages');
    await row('Languages').click();
    await expect(page.getByRole('tree', { name: 'Decks' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(selected()).toContainText('French');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Control+a');
    await page.keyboard.type('France');
    await page.keyboard.press('Enter');
    await expect(row('France')).toBeVisible();
    await expect(selected()).toContainText('France');
    await expect(row('Languages')).toBeVisible();
  });

  test('at 360px rows are at least 44px and the tab does not steal keys', async () => {
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(page.getByRole('tab', { name: 'Decks' })).toBeVisible();
    const heights = await page
      .getByRole('treeitem')
      .evaluateAll((rows) => rows.map((item) => item.getBoundingClientRect().height));
    expect(heights.length).toBeGreaterThanOrEqual(3);
    for (const height of heights) {
      expect(height).toBeGreaterThanOrEqual(44);
    }
    const fit = await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth <= root.clientWidth + 1;
    });
    expect(fit).toBe(true);
    const tab = page.getByRole('tab', { name: 'Decks' });
    const studyTab = page.getByRole('tab', { name: 'Study' });
    await expect(studyTab).toBeVisible();
    await tab.click();
    await page.keyboard.press('ArrowRight');
    await expect(studyTab).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(tab).toBeFocused();
    await page.keyboard.press('End');
    await expect(studyTab).toBeFocused();
    await page.keyboard.press('Home');
    await expect(tab).toBeFocused();
    for (const key of ['ArrowDown', 'j', 'k', '1', '2', '3', '4']) {
      await page.keyboard.press(key);
      await expect(tab).toBeFocused();
    }
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/$/);
    await tab.click();
    await page.keyboard.press('Space');
    await expect(page).toHaveURL(/\/$/);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('delete shows impact, and trash and move keep a bad target', async () => {
    await openHome();
    await createRoot('Other');
    await focusTree();
    await page.keyboard.press('Home');
    await page.keyboard.press('l');
    await row('Languages').click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(deleteDialog()).toContainText('Decks 3.');
    await expect(deleteDialog()).toContainText('Notes 1.');
    const options = page.locator('#move-target option');
    await expect(options.filter({ hasText: 'Languages' })).toHaveCount(0);
    await expect(options.filter({ hasText: 'France' })).toHaveCount(0);
    await expect(options.filter({ hasText: 'Spanish' })).toHaveCount(0);
    await expect(options.filter({ hasText: 'Other' })).toHaveCount(1);
    await expect(selected()).toContainText('Languages');
    for (const key of ['ArrowDown', '1', '2', '3', '4', ' ']) {
      await page.keyboard.press(key);
    }
    await expect(row('Languages')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(deleteDialog()).toBeHidden();
    await expect(page.getByRole('button', { name: 'Delete' })).toBeFocused();
    await page.getByRole('button', { name: 'Delete' }).click();
    for (let step = 0; step < 6; step += 1) {
      await page.keyboard.press('Tab');
      await expect(deleteDialog().locator(':focus')).toHaveCount(1);
    }
    await page.keyboard.press('Escape');
    await expect(deleteDialog()).toBeHidden();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.keyboard.press('Tab');
    await expect(deleteDialog().getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(deleteDialog()).toBeHidden();
    await expect(row('Languages')).toBeVisible();
    await row('Spanish').click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.locator('#move-target').selectOption({ label: 'Other' });
    await page.getByRole('button', { name: 'Move' }).click();
    await expect(deleteDialog()).toBeHidden();
    await expect(row('Spanish')).toHaveCount(0);
    await expect(row('Other')).toContainText('New 1');
    await expect(row('Languages')).toContainText('New 0');
    await row('France').click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Trash' }).click();
    await expect(row('France')).toHaveCount(0);
    await expect(row('Languages')).toBeVisible();
  });
});
