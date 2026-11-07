import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { resetAuthViaCli } from './support/cli';
import { removeRootDecks } from './support/study-screen';
import { addAuthenticator, enableWebAuthn } from './support/virtual-authenticator';

const CLIENT_IP = '198.51.100.48';

let context: BrowserContext;
let page: Page;

function row(name: string) {
  return page.getByRole('treeitem', { name: new RegExp(`^${name}\\b`) });
}

function card() {
  return page.locator('.study-card');
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
  await page.getByLabel('Nickname').fill('FullLoop');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Save these codes now. They are shown once.')).toBeVisible();
  await removeRootDecks(page);
}

async function openHome(): Promise<void> {
  const response = await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('tui-page'));
  expect(response?.headers()['cache-control']).toBe('no-store');
  await expect(page.getByRole('heading', { name: 'Decks', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create root' })).toBeEnabled();
}

async function createRootViaUi(name: string): Promise<void> {
  await page.getByLabel('Deck name').fill(name);
  await page.getByRole('button', { name: 'Create root' }).click();
  await expect(row(name)).toBeVisible();
}

async function addBasicNoteViaUi(deckName: string, front: string, back: string): Promise<void> {
  await row(deckName).click();
  await page.getByRole('link', { name: 'Add note' }).click();
  await expect(page).toHaveURL(/\/notes\/new/);
  await expect(page.getByRole('heading', { name: 'Add note', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
  await page.getByLabel('Front').fill(front);
  await page.getByLabel('Back').fill(back);
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForURL(/\/notes\/[0-9a-f-]{36}$/i);
  await expect(page.getByLabel('Front')).toHaveValue(front);
  await expect(page.getByLabel('Back')).toHaveValue(back);
}

async function studyDeckViaUi(deckName: string): Promise<void> {
  await openHome();
  await row(deckName).click();
  await page.getByRole('link', { name: 'Study' }).click();
  await expect(page).toHaveURL(/\/study\?deck=/);
  await expect(page.getByRole('heading', { name: 'Study', level: 1 })).toBeVisible();
}

async function assertFinishedAndCounts(deckName: string): Promise<void> {
  await expect(page.getByText('No cards left.')).toBeVisible();
  await expect(page.getByText('Next due in 8d')).toBeVisible();
  await openHome();
  await expect(row(deckName)).toContainText('New 0');
  await expect(row(deckName)).toContainText('Learning 0');
  await expect(row(deckName)).toContainText('Due 0');
}

test.describe.serial('full loop', () => {
  test.beforeAll(async ({ browser }) => {
    await signIn(browser);
  });

  test.afterAll(async () => {
    await removeRootDecks(page);
    await context.close();
  });

  test('desktop: create deck, add note, study, see next due', async () => {
    await openHome();
    await createRootViaUi('Loop Desktop');
    await expect(row('Loop Desktop')).toContainText('New 0');
    await addBasicNoteViaUi('Loop Desktop', 'gato', 'cat');
    await openHome();
    await expect(row('Loop Desktop')).toContainText('New 1');
    await studyDeckViaUi('Loop Desktop');
    await expect(card()).toContainText('gato');
    await expect(page.getByText('cat', { exact: true })).toHaveCount(0);
    await expect(page.getByText('New 1')).toBeVisible();
    await page.keyboard.press('Space');
    await expect(card()).toContainText('cat');
    await page.keyboard.press('4');
    await assertFinishedAndCounts('Loop Desktop');
  });

  test('mobile 360px: tab bar loop including Settings', async () => {
    await page.setViewportSize({ width: 360, height: 800 });
    await openHome();
    await expect(page.getByRole('tab', { name: 'Decks' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Study' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Browse' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Settings' })).toBeVisible();
    await page.getByRole('tab', { name: 'Decks' }).click();
    await expect(page).toHaveURL(/\/$/);
    await createRootViaUi('Loop Phone');
    await addBasicNoteViaUi('Loop Phone', 'perro', 'dog');
    await page.getByRole('tab', { name: 'Decks' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Decks', level: 1 })).toBeVisible();
    await expect(row('Loop Phone')).toContainText('New 1');
    await row('Loop Phone').click();
    await page.getByRole('link', { name: 'Study' }).click();
    await expect(page).toHaveURL(/\/study\?deck=/);
    await expect(page.getByRole('heading', { name: 'Study', level: 1 })).toBeVisible();
    await expect(card()).toContainText('perro');
    await page.getByRole('button', { name: 'Reveal' }).click();
    await expect(card()).toContainText('dog');
    await page.getByRole('button', { name: /^Easy / }).click();
    await expect(page.getByText('No cards left.')).toBeVisible();
    await expect(page.getByText('Next due in 8d')).toBeVisible();
    await page.getByRole('tab', { name: 'Decks' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Decks', level: 1 })).toBeVisible();
    await expect(row('Loop Phone')).toContainText('New 0');
    await expect(row('Loop Phone')).toContainText('Learning 0');
    await expect(row('Loop Phone')).toContainText('Due 0');
    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    await expect(page.getByRole('listbox', { name: 'Settings sections' })).toBeVisible();
  });
});
