import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { E2E_ORIGIN, resetAuthViaCli } from './support/cli';
import { csrf, removeRootDecks } from './support/study-screen';
import { addAuthenticator, enableWebAuthn } from './support/virtual-authenticator';
const CLIENT_IP = '198.51.100.44'; // .43 is used by note-editor-race.
const BASIC_ID = '00000000-0000-4000-8000-000000000011';

let context: BrowserContext;
let page: Page;
let gatoNote = '';
let perroNote = '';
let casaNote = '';
let perroCard = '';

function dataRows() {
  return page.getByRole('row').filter({ has: page.getByRole('checkbox') });
}

function selectedRow() {
  return page.getByRole('row', { selected: true });
}

function dialog() {
  return page.getByRole('dialog', { name: 'Delete selected notes' });
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
  await page.getByLabel('Nickname').fill('Browse');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Save these codes now. They are shown once.')).toBeVisible();
  await removeRootDecks(page);
}

async function postNote(deckId: string, front: string, tags: string[]): Promise<string> {
  const response = await page.request.post('/api/notes', {
    headers: {
      origin: E2E_ORIGIN,
      'x-srep-csrf': await csrf(page),
      'content-type': 'application/json',
    },
    data: { noteTypeId: BASIC_ID, deckId, fields: [front, `${front}-back`], tags },
  });
  expect(response.status()).toBe(201);
  const body: { note: { id: string; cards: { id: string }[] } } = await response.json();
  const cardId = body.note.cards[0]?.id;
  if (cardId === undefined) {
    throw new Error('missing card');
  }
  if (front === 'perro') {
    perroCard = cardId;
    setLapses(cardId, 4);
  }
  return body.note.id;
}

function setLapses(cardId: string, lapses: number): void {
  const db = new Database('data/e2e.db');
  try {
    db.pragma('busy_timeout = 5000');
    const info = db.prepare('update card set lapses = ? where id = ?').run(lapses, cardId);
    if (info.changes !== 1) {
      throw new Error('lapse update missed');
    }
  } finally {
    db.close();
  }
}

async function createDeck(name: string): Promise<string> {
  const response = await page.request.post('/api/decks', {
    headers: {
      origin: E2E_ORIGIN,
      'x-srep-csrf': await csrf(page),
      'content-type': 'application/json',
    },
    data: { name },
  });
  expect(response.status()).toBe(201);
  const body: { deck: { id: string } } = await response.json();
  return body.deck.id;
}

async function openBrowse(): Promise<void> {
  const response = await page.goto('/browse');
  await page.waitForFunction(() => document.body.classList.contains('tui-page'));
  expect(response?.headers()['cache-control']).toBe('no-store');
  await expect(page.getByRole('heading', { name: 'Browse', level: 1 })).toBeVisible();
  await expect(dataRows()).toHaveCount(3);
}

async function search(q: string): Promise<void> {
  const field = page.getByLabel('Search');
  await expect(page.getByRole('button', { name: 'Search' })).toBeEnabled();
  await field.fill(q);
  const pending = page.waitForResponse((response) => {
    if (response.request().method() !== 'GET') {
      return false;
    }
    const url = new URL(response.url());
    return url.pathname === '/api/browse' && (url.searchParams.get('q') ?? '') === q;
  });
  await field.press('Enter');
  await pending;
}

async function focusGrid(): Promise<void> {
  await dataRows().first().getByRole('gridcell').first().click();
  await expect(page.getByRole('grid', { name: 'Cards' })).toBeFocused();
}

test('guest GET /browse returns 303 to setup or login', async ({ request }) => {
  const response = await request.get('/browse', {
    maxRedirects: 0,
    headers: { 'x-forwarded-for': CLIENT_IP },
  });
  expect(response.status()).toBe(303);
  expect(response.headers().location).toMatch(/\/(setup|login)$/);
});

test.describe.serial('browse screen', () => {
  test.beforeAll(async ({ browser }) => {
    await signIn(browser);
    const spanish = await createDeck('Spanish');
    await createDeck('French');
    gatoNote = await postNote(spanish, 'gato', ['animals']);
    perroNote = await postNote(spanish, 'perro', []);
    casaNote = await postNote(spanish, 'casa', []);
    expect(gatoNote).not.toBe(perroNote);
    expect(casaNote).not.toBe('');
  });

  test.afterAll(async () => {
    if (perroCard !== '') {
      setLapses(perroCard, 0);
    }
    await context.close();
  });

  test('a signed-in user sees three rows', async () => {
    await openBrowse();
    await expect(dataRows().filter({ hasText: 'gato' })).toBeVisible();
    await expect(dataRows().filter({ hasText: 'perro' })).toBeVisible();
    await expect(dataRows().filter({ hasText: 'casa' })).toBeVisible();
    await expect(page.locator('.browse-grid b')).toHaveCount(0);
    await expect(page.locator('.browse-grid script')).toHaveCount(0);
  });

  test('at 360px three rows are reachable and buttons are at least 44px', async () => {
    await page.setViewportSize({ width: 360, height: 800 });
    await focusGrid();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('j');
    const third = (await dataRows().nth(2).innerText()).trim();
    await expect(selectedRow()).toHaveText(third);
    const searchBox = await page.getByRole('button', { name: 'Search' }).boundingBox();
    expect(searchBox?.height).toBeGreaterThanOrEqual(44);
    for (const name of ['Move', 'Add tag', 'Remove tag', 'Suspend', 'Delete']) {
      const box = await page.getByRole('button', { name, exact: true }).boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    const fit = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    );
    expect(fit).toBe(true);
    await page.getByRole('tab', { name: 'Browse' }).click();
    await expect(page).toHaveURL(/\/browse$/);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('grid keys move three rows and do not delete', async () => {
    await openBrowse();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    const third = (await dataRows().nth(2).innerText()).trim();
    await expect(selectedRow()).toHaveText(third);
    await page.keyboard.press('Home');
    const first = (await selectedRow().innerText()).trim();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('j');
    await expect(selectedRow()).toHaveText(third);
    await page.keyboard.press('ArrowDown');
    await expect(selectedRow()).toHaveText(third);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('k');
    await expect(selectedRow()).toHaveText(first);
    await page.keyboard.press('End');
    await expect(selectedRow()).toHaveText(third);
    await page.keyboard.press('Home');
    const before = await page.evaluate(() => window.scrollY);
    await page.keyboard.press('Space');
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
    await expect(dataRows().first().getByRole('checkbox')).toBeChecked();
    for (const key of ['1', '2', '3', '4', 'h', 'l', 'PageUp', 'PageDown', 'Delete', 'Backspace']) {
      await page.keyboard.press(key);
      await expect(selectedRow()).toHaveText(first);
    }
    await expect(dataRows()).toHaveCount(3);
    await page.keyboard.press('Control+a');
    await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(3);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(0);
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog', { name: 'Commands' })).toBeVisible();
    await expect(selectedRow()).toHaveText(first);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Commands' })).toBeHidden();
  });

  test('query keys type and do not move the row or rate', async () => {
    await focusGrid();
    await page.keyboard.press('Home');
    const first = (await selectedRow().innerText()).trim();
    const field = page.getByLabel('Search');
    await field.click();
    await page.keyboard.type('ga to:');
    await page.keyboard.press('1');
    await page.keyboard.press('2');
    await page.keyboard.press('3');
    await page.keyboard.press('4');
    await page.keyboard.press('j');
    await page.keyboard.press('k');
    await expect(field).toHaveValue('ga to:1234jk');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await expect(field).toHaveValue('ga to:1234jk');
    await expect(page.getByRole('dialog', { name: 'Commands' })).toBeHidden();
    await expect(selectedRow()).toHaveText(first);
    await page.keyboard.press('Control+a');
    await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(0);
    const span = await field.evaluate(
      (node: HTMLInputElement) => node.selectionEnd - node.selectionStart,
    );
    expect(span).toBe('ga to:1234jk'.length);
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog', { name: 'Commands' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(field).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(field).toHaveValue('');
    await page.keyboard.press('Escape');
    await expect(field).not.toBeFocused();
  });

  test('search syntax shows the matching rows', async () => {
    await search('tag:animals');
    await expect(dataRows()).toHaveCount(1);
    await expect(dataRows().first()).toContainText('gato');
    await search('deck:Spanish');
    await expect(dataRows()).toHaveCount(3);
    await search('prop:lapses>3');
    await expect(dataRows()).toHaveCount(1);
    await expect(dataRows().first()).toContainText('perro');
    await expect(dataRows().first()).toContainText('4');
    await search('is:suspended');
    await expect(page.getByText('No cards.')).toBeVisible();
    await search('prop:lapses!');
    await expect(page.getByRole('alert')).toHaveText('The search is not valid.');
    const seen: string[] = [];
    const onRequest = (request: { url: () => string }) => {
      if (request.url().includes('/api/browse')) {
        seen.push(request.url());
      }
    };
    page.on('request', onRequest);
    await search('<script>');
    page.off('request', onRequest);
    expect(seen.some((url) => url.includes('<'))).toBe(false);
    expect(seen.some((url) => url.includes('/api/browse?'))).toBe(true);
  });

  test('Enter opens one note and the next note does not keep those fields', async () => {
    await search('');
    await expect(dataRows()).toHaveCount(3);
    await dataRows().filter({ hasText: 'gato' }).click();
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/notes\/[0-9a-f-]{36}$/i);
    await expect(page.getByLabel('Front')).toHaveValue('gato');
    await page.getByLabel('Front').fill('LEAK-A');
    await page.goto(`/notes/${perroNote}`);
    await page.waitForFunction(() => document.body.classList.contains('tui-page'));
    await expect(page.getByLabel('Front')).toHaveValue('perro');
    await expect(page.getByLabel('Front')).not.toHaveValue('LEAK-A');
    await page.goto(`/notes/${gatoNote}`);
    await expect(page.getByLabel('Front')).toHaveValue('gato');
  });

  test('bulk move, tag, and suspend update the selected rows', async () => {
    await openBrowse();
    await page.getByRole('checkbox', { name: 'Select gato' }).check();
    await page.getByLabel('Tag').fill('pets');
    await page.getByRole('button', { name: 'Add tag' }).click();
    await search('tag:pets');
    await expect(dataRows()).toHaveCount(1);
    await expect(dataRows().first()).toContainText('gato');
    await page.getByRole('checkbox', { name: 'Select gato' }).check();
    await page
      .getByRole('listbox', { name: 'Deck' })
      .getByRole('option', { name: 'French' })
      .click();
    await page.getByRole('button', { name: 'Move', exact: true }).click();
    await search('deck:French');
    await expect(dataRows()).toHaveCount(1);
    await expect(dataRows().first()).toContainText('gato');
    await page.getByRole('checkbox', { name: 'Select gato' }).check();
    await page.getByRole('button', { name: 'Suspend' }).click();
    await search('is:suspended');
    await expect(dataRows()).toHaveCount(1);
    await expect(dataRows().first()).toContainText('gato');
    await expect(dataRows().first()).toContainText('suspended');
  });

  test('the delete dialog traps Tab and returns focus', async () => {
    await search('deck:Spanish');
    await page.getByRole('checkbox', { name: 'Select casa' }).check();
    const opener = page.getByRole('button', { name: 'Delete' });
    await opener.click();
    await expect(dialog()).toBeVisible();
    const before = (await selectedRow().innerText()).trim();
    await page.keyboard.press('ArrowDown');
    await expect(selectedRow()).toHaveText(before);
    await page.keyboard.press('Tab');
    await expect(dialog().getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog().getByRole('button', { name: 'Confirm delete' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog().getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog().getByRole('button', { name: 'Confirm delete' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog()).toBeHidden();
    await expect(opener).toBeFocused();
    await expect(dataRows().filter({ hasText: 'casa' })).toBeVisible();
  });

  test('a missing id does not delete the other note', async () => {
    await search('');
    await expect(dataRows().filter({ hasText: 'perro' })).toBeVisible();
    const trashed = await page.request.post('/api/notes/trash', {
      headers: {
        origin: E2E_ORIGIN,
        'x-srep-csrf': await csrf(page),
        'content-type': 'application/json',
      },
      data: { noteIds: [perroNote] },
    });
    expect(trashed.ok()).toBeTruthy();
    await page.getByRole('checkbox', { name: 'Select perro' }).check();
    await page.getByRole('checkbox', { name: 'Select casa' }).check();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert')).toHaveText(
      'One selected card was not found. Nothing was changed.',
    );
    await page.keyboard.press('Escape');
    await search('casa');
    await expect(dataRows().filter({ hasText: 'casa' })).toBeVisible();
  });

  test('confirm delete removes the selected note', async () => {
    await search('is:suspended');
    await page.getByRole('checkbox', { name: 'Select gato' }).check();
    await page.getByLabel('Tag').fill('<script>');
    await page.getByRole('button', { name: 'Add tag' }).click();
    await expect(dataRows().first()).toContainText('<script>');
    await expect(page.locator('.browse-grid script')).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'Select gato' }).check();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(dialog().getByRole('button', { name: 'Confirm delete' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog()).toBeHidden();
    await search('tag:pets');
    await expect(page.getByText('No cards.')).toBeVisible();
  });

  test('Open Browse goes to the browse page', async () => {
    await page.goto('/');
    await page.waitForFunction(() => document.body.classList.contains('tui-page'));
    await page.keyboard.press('Control+k');
    await page.getByRole('dialog', { name: 'Commands' }).getByRole('textbox').fill('browse');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/browse$/);
    await expect(page.getByRole('heading', { name: 'Browse', level: 1 })).toBeVisible();
  });
});
