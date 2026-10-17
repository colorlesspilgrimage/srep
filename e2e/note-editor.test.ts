import { expect, test, type Page } from '@playwright/test';
import { makeDecks, openNewNote, postNote, signInEditor, TINY_PNG } from './support/note-editor';

// Contract: note editor keys, preview, cloze, media, and edit.
// Deck keys use page.keyboard on Alpha, Beta, and Gamma.
// This file uses its own client IP.

const CLIENT_IP = '198.51.100.42';

let page: Page;
let alpha = '';
let noteId = '';

function deckList() {
  return page.getByRole('listbox', { name: 'Deck' });
}

function selectedDeck() {
  return deckList().getByRole('option', { selected: true });
}

function commands() {
  return page.getByRole('dialog', { name: 'Commands' });
}

test('guest note pages redirect and preview is 401', async ({ request }) => {
  const headers = { 'x-forwarded-for': CLIENT_IP };
  const created = await request.get('/notes/new', { maxRedirects: 0, headers });
  expect(created.status()).toBe(303);
  expect(created.headers().location).toMatch(/\/(setup|login)$/);
  const edited = await request.get('/notes/not-a-note', { maxRedirects: 0, headers });
  expect(edited.status()).toBe(303);
  const preview = await request.post('/api/notes/preview', {
    headers: { ...headers, 'content-type': 'application/json' },
    data: {},
  });
  expect(preview.status()).toBe(401);
});

test.describe.serial('note editor', () => {
  test.beforeAll(async ({ browser }) => {
    const signed = await signInEditor(browser);
    page = signed.page;
    const decks = await makeDecks(page);
    alpha = decks.alpha;
  });

  test.afterAll(async () => {
    await page.context().close();
  });

  test('a preview shows the field and does not add a note', async () => {
    await openNewNote(page, alpha);
    await expect(deckList().getByRole('option')).toHaveCount(3);
    await expect(selectedDeck()).toHaveText('Alpha');
    await page.getByLabel('Front').fill('gato');
    await expect(page.locator('.note-preview')).toContainText('gato');
    const next = await page.request.get(`/api/study/next?deckId=${encodeURIComponent(alpha)}`);
    expect((await next.json()).status).not.toBe('card');
  });

  test('field keys type and do not change the deck or save', async () => {
    await openNewNote(page, alpha);
    const front = page.getByLabel('Front');
    await front.click();
    await page.keyboard.type('ab');
    for (const key of ['ArrowDown', 'ArrowUp', 'j', 'k', '1', '2', '3', '4', ' ', 'Enter', ':']) {
      await page.keyboard.press(key);
    }
    const typed = await front.inputValue();
    for (const part of ['j', 'k', '1', '2', '3', '4', ' ', '\n', ':']) {
      expect(typed).toContain(part);
    }
    await expect(selectedDeck()).toHaveText('Alpha');
    await expect(page).toHaveURL(/\/notes\/new/);
    await expect(commands()).toBeHidden();
    await front.fill('gato');
    await front.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Alt+c');
    await expect(front).toHaveValue('{{c1::gato}}');
    await page.keyboard.press('Control+k');
    await expect(commands()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(commands()).toBeHidden();
    await expect(front).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(front).not.toBeFocused();
  });

  test('Tab and Shift+Tab move through fields, tags, the deck, and Save', async () => {
    await openNewNote(page, alpha);
    await page.getByLabel('Front').click();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Back')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Tags')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByLabel('Back')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Tags')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(deckList()).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Save' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(deckList()).toBeFocused();
  });

  test('deck keys move on three decks and do not save', async () => {
    await openNewNote(page, alpha);
    await deckList().click();
    await page.keyboard.press('Home');
    await expect(selectedDeck()).toHaveText('Alpha');
    await page.keyboard.press('ArrowDown');
    await expect(selectedDeck()).toHaveText('Beta');
    await page.keyboard.press('j');
    await expect(selectedDeck()).toHaveText('Gamma');
    await page.keyboard.press('ArrowDown');
    await expect(selectedDeck()).toHaveText('Gamma');
    await page.keyboard.press('j');
    await expect(selectedDeck()).toHaveText('Gamma');
    await page.keyboard.press('ArrowUp');
    await expect(selectedDeck()).toHaveText('Beta');
    await page.keyboard.press('k');
    await expect(selectedDeck()).toHaveText('Alpha');
    await page.keyboard.press('ArrowUp');
    await expect(selectedDeck()).toHaveText('Alpha');
    await page.keyboard.press('End');
    await expect(selectedDeck()).toHaveText('Gamma');
    await page.keyboard.press('Home');
    await expect(selectedDeck()).toHaveText('Alpha');
    await page.keyboard.press('Enter');
    await expect(selectedDeck()).toHaveText('Alpha');
    await expect(page).toHaveURL(/\/notes\/new/);
    for (const key of [' ', '1', '2', '3', '4', 'h', 'l']) {
      await page.keyboard.press(key);
      await expect(selectedDeck()).toHaveText('Alpha');
    }
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Save' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(deckList()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(deckList()).not.toBeFocused();
  });

  test('Save ignores rating keys and Enter creates the note', async () => {
    await openNewNote(page, alpha);
    await page.getByLabel('Front').fill('gato');
    await page.getByLabel('Back').fill('cat');
    await page.getByLabel('Tags').fill('animals');
    await page.getByLabel('Tags').click();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Save' })).toBeFocused();
    for (const key of ['1', '2', '3', '4']) {
      await page.keyboard.press(key);
    }
    await expect(page).toHaveURL(/\/notes\/new/);
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/notes\/[0-9a-f-]{36}$/i);
    noteId = page.url().split('/').pop() ?? '';
    await expect(page.getByLabel('Front')).toHaveValue('gato');
    await expect(page.getByLabel('Back')).toHaveValue('cat');
    await expect(page.getByLabel('Tags')).toHaveValue('animals');
    await page.reload();
    await expect(page.getByLabel('Front')).toHaveValue('gato');
    await expect(page.getByLabel('Back')).toHaveValue('cat');
  });

  test('Space on Save creates a note and an edit keeps the same id', async () => {
    await openNewNote(page, alpha);
    await page.getByLabel('Front').fill('perro');
    await page.getByLabel('Back').fill('dog');
    await page.getByLabel('Tags').click();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Save' })).toBeFocused();
    await page.keyboard.press(' ');
    await page.waitForURL(/\/notes\/[0-9a-f-]{36}$/i);
    const id = page.url().split('/').pop() ?? '';
    await page.getByLabel('Front').fill('perro2');
    const patch = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/notes/${id}`) && response.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: 'Save' }).click();
    expect((await patch).ok()).toBeTruthy();
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/notes/${id}$`));
    await expect(page.getByLabel('Front')).toHaveValue('perro2');
  });

  test('Cloze 1 wraps the selection and the preview shows a gap', async () => {
    await openNewNote(page, alpha);
    await page.getByLabel('Note type').selectOption({ label: 'Cloze' });
    const text = page.getByLabel('Text');
    await text.fill('gato');
    await text.click();
    await page.keyboard.press('Control+a');
    await page.getByRole('button', { name: 'Cloze 1' }).click();
    await expect(text).toHaveValue('{{c1::gato}}');
    await expect(page.locator('.note-preview')).toContainText('[...]');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForURL(/\/notes\/[0-9a-f-]{36}$/i);
  });

  test('a PNG upload inserts a media token and a script stays text', async () => {
    await openNewNote(page, alpha);
    await page.getByLabel('Front').click();
    await page.getByLabel('Upload').setInputFiles({
      name: 'dot.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    });
    await expect(page.getByLabel('Front')).toHaveValue(/\{\{media:[0-9a-f]{64}\}\}/);
    const images = page.locator('.note-preview img');
    await expect(images).toHaveCount(2);
    await expect(images.nth(0)).toHaveAttribute('src', /\/api\/media\/[0-9a-f]{64}$/);
    await expect(images.nth(1)).toHaveAttribute('src', /\/api\/media\/[0-9a-f]{64}$/);
    await page.getByLabel('Front').fill('<script>alert(1)</script>');
    await expect(page.locator('.note-preview')).toContainText('alert(1)');
    await expect(page.locator('.note-preview script')).toHaveCount(0);
  });

  test('a duplicate first field warns and still saves', async () => {
    await openNewNote(page, alpha);
    await page.getByLabel('Front').fill('gato');
    await page.getByLabel('Back').fill('cat');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForURL(/\/notes\/[0-9a-f-]{36}$/i);
    await expect(page.getByText('A note with this first field already exists.')).toBeVisible();
  });

  test('a bad id does not call the note API', async () => {
    const hits: string[] = [];
    const onRequest = (request: { url: () => string }) => {
      if (request.url().includes('/api/notes/')) {
        hits.push(request.url());
      }
    };
    page.on('request', onRequest);
    await page.goto('/notes/not-a-note');
    await expect(page.getByText('That note id is not valid.')).toBeVisible();
    expect(hits).toEqual([]);
    page.off('request', onRequest);
  });

  test('Add note and Full editor open the right note', async () => {
    if (noteId === '') {
      noteId = await postNote(page, alpha, ['gato', 'cat']);
    }
    await page.goto('/');
    await expect(page.getByRole('treeitem', { name: /^Alpha\b/ })).toBeVisible();
    await page.getByRole('treeitem', { name: /^Alpha\b/ }).click();
    await page.getByRole('link', { name: 'Add note' }).click();
    await expect(page).toHaveURL(new RegExp(`/notes/new\\?deck=${alpha}$`));
    await page.goto(`/study?deck=${encodeURIComponent(alpha)}`);
    const link = page.getByRole('link', { name: 'Full editor' });
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toMatch(/\/notes\/[0-9a-f-]{36}$/i);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.getByLabel('Front')).toBeVisible();
  });

  test('Camera and Save are at least 44px at 360px', async () => {
    await page.setViewportSize({ width: 360, height: 700 });
    await openNewNote(page, alpha);
    const save = await page.getByRole('button', { name: 'Save' }).boundingBox();
    const camera = await page.getByLabel('Camera').boundingBox();
    const preview = await page.locator('.note-preview').boundingBox();
    expect(save?.height).toBeGreaterThanOrEqual(44);
    expect(camera?.height).toBeGreaterThanOrEqual(44);
    expect(preview && save && preview.y < save.y).toBeTruthy();
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
    await expect(page.getByLabel('Camera')).toBeVisible();
  });
});
