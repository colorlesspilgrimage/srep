import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type Request,
} from '@playwright/test';
import { resetAuthViaCli } from './support/cli';
import { studyClockHeader } from './support/study-clock';
import {
  addNote,
  createDeck,
  drainUndo,
  openStudy,
  removeRootDecks,
  untilText,
} from './support/study-screen';
import { addAuthenticator, enableWebAuthn } from './support/virtual-authenticator';

// Contract: study screen keys, congrats, wait, undo, suspend, edit, and mobile buttons.
// Keys use page.keyboard. The queue has three notes. Each file uses its own client IP.

const CLIENT_IP = '198.51.100.41';

let context: BrowserContext;
let page: Page;

function card() {
  return page.locator('.study-card');
}

function editDialog() {
  return page.getByRole('dialog', { name: 'Edit note' });
}

function commands() {
  return page.getByRole('dialog', { name: 'Commands' });
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
  await page.getByLabel('Nickname').fill('Study');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Save these codes now. They are shown once.')).toBeVisible();
  await removeRootDecks(page);
  await drainUndo(page);
}

async function answerBody(): Promise<{ rating: number; reps: number; elapsedMs: number }> {
  const request = page.waitForRequest(
    (req: Request) => req.method() === 'POST' && req.url().includes('/api/study/answer'),
  );
  await page.keyboard.press('3');
  const body = (await request).postDataJSON() as {
    rating: number;
    reps: number;
    elapsedMs: number;
  };
  return body;
}

test('guest GET /study returns 303 to setup or login', async ({ request }) => {
  const response = await request.get('/study', {
    maxRedirects: 0,
    headers: { 'x-forwarded-for': CLIENT_IP },
  });
  expect(response.status()).toBe(303);
  expect(response.headers().location).toMatch(/\/(setup|login)$/);
});

test.describe.serial('study screen', () => {
  test.beforeAll(async ({ browser }) => {
    await signIn(browser);
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('three cards stay put until reveal and a rate sends reps', async () => {
    const deckId = await createDeck(page, 'Study Queue');
    await addNote(page, deckId, 'gato', 'cat');
    await addNote(page, deckId, 'perro', 'dog');
    await addNote(page, deckId, 'casa', 'house');
    await openStudy(page, deckId);
    await expect(card()).toContainText('gato');
    await expect(page.getByText('cat', { exact: true })).toHaveCount(0);
    await expect(page.getByText('New 3')).toBeVisible();
    await expect(page.getByText('Learning 0')).toBeVisible();
    await expect(page.getByText('Due 0')).toBeVisible();
    for (const name of [
      '1',
      '2',
      '3',
      '4',
      'ArrowDown',
      'ArrowUp',
      'j',
      'k',
      'Home',
      'End',
      'PageUp',
      'PageDown',
      'Escape',
    ]) {
      await page.keyboard.press(name);
      await expect(card()).toContainText('gato');
      await expect(page.getByText('cat', { exact: true })).toHaveCount(0);
    }
    await page.keyboard.press('u');
    await expect(page.getByText('Nothing to undo.')).toBeVisible();
    await page.keyboard.press('Control+k');
    await expect(commands()).toBeVisible();
    await expect(page.getByText('cat', { exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.keyboard.press(':');
    await expect(commands()).toBeVisible();
    await page.keyboard.press('Escape');
    await card().click();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Reveal' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Undo' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Suspend' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Edit' })).toBeFocused();
    await card().click();
    await page.keyboard.press('Space');
    await expect(card()).toContainText('cat');
    for (const name of [
      'ArrowDown',
      'ArrowUp',
      'j',
      'k',
      'Home',
      'End',
      'h',
      'l',
      'PageUp',
      'PageDown',
    ]) {
      await page.keyboard.press(name);
      await expect(card()).toContainText('gato');
    }
    await page.keyboard.press('Enter');
    await expect(card()).toContainText('cat');
    const body = await answerBody();
    expect(body.rating).toBe(3);
    expect(body.reps).toBe(0);
    expect(Number.isInteger(body.elapsedMs)).toBe(true);
    expect(body.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(body.elapsedMs).toBeLessThanOrEqual(3_600_000);
    await expect(card()).toContainText('perro');
    await expect(card()).not.toContainText('gato');
    await card().click();
    await page.keyboard.press('1');
    await expect(card()).toContainText('perro');
    await expect(page.getByText('dog', { exact: true })).toHaveCount(0);
    await page.keyboard.press('Space');
    await expect(card()).toContainText('dog');
    const ratings: number[] = [];
    const onRequest = (req: Request): void => {
      if (req.method() === 'POST' && req.url().includes('/api/study/answer')) {
        ratings.push((req.postDataJSON() as { rating: number }).rating);
      }
    };
    page.on('request', onRequest);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: /^Again / })).toBeFocused();
    await page.keyboard.press('Space');
    await expect.poll(() => ratings).toEqual([1]);
    page.off('request', onRequest);
    await expect(card()).toContainText('casa');
    await card().click();
    await page.keyboard.press('Space');
    await expect(card()).toContainText('house');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: /^Good / })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Next card at')).toBeVisible();
    await page.keyboard.press('u');
    await expect(card()).toContainText('casa');
    await expect(page.getByText('house', { exact: true })).toHaveCount(0);
  });

  test('Easy on the only new card shows 8d and undo restores the front', async () => {
    const deckId = await createDeck(page, 'Study Solo');
    await addNote(page, deckId, 'gato', 'cat');
    await openStudy(page, deckId);
    await expect(card()).toContainText('gato');
    await expect(page.getByText('cat', { exact: true })).toHaveCount(0);
    await page.keyboard.press('1');
    await expect(page.getByText('cat', { exact: true })).toHaveCount(0);
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: /8d/ })).toBeVisible();
    await page.keyboard.press('4');
    await expect(page.getByText('No cards left.')).toBeVisible();
    await expect(page.getByText('Next due in 8d')).toBeVisible();
    await page.keyboard.press('u');
    await expect(card()).toContainText('gato');
    await expect(page.getByText('cat', { exact: true })).toHaveCount(0);
    await expect(page.getByText('No cards left.')).toHaveCount(0);
  });

  test('Again on the only new card shows the wait state', async () => {
    const deckId = await createDeck(page, 'Study Wait');
    await addNote(page, deckId, 'hola', 'hello');
    await openStudy(page, deckId);
    await page.keyboard.press('Space');
    await page.keyboard.press('1');
    await expect(page.getByText('Next card at')).toBeVisible();
    const next = await page.request.get(`/api/study/next?deckId=${encodeURIComponent(deckId)}`);
    const body: { status: string; until: number } = await next.json();
    expect(body.status).toBe('wait');
    await expect(page.getByText(`Next card at ${untilText(body.until)}`)).toBeVisible();
    const hits: string[] = [];
    const onRequest = (req: Request): void => {
      if (req.method() === 'POST' && req.url().includes('/api/study/answer')) {
        hits.push(req.url());
      }
    };
    page.on('request', onRequest);
    for (const name of ['1', '2', '3', '4', ' ']) {
      await page.keyboard.press(name);
    }
    await page.keyboard.press('e');
    await expect(editDialog()).toBeHidden();
    await page.keyboard.press('s');
    await expect(page.getByText(`Next card at ${untilText(body.until)}`)).toBeVisible();
    expect(hits).toEqual([]);
    page.off('request', onRequest);
    await page.keyboard.press('u');
    await expect(card()).toContainText('hola');
  });

  test('suspend moves to the other card and hides the suspended front', async () => {
    const deckId = await createDeck(page, 'Study Suspend');
    await addNote(page, deckId, 'gato', 'cat');
    await addNote(page, deckId, 'perro', 'dog');
    await openStudy(page, deckId);
    await expect(card()).toContainText('gato');
    await page.keyboard.press('s');
    await expect(card()).toContainText('perro');
    await expect(card()).not.toContainText('gato');
    await page.reload();
    await expect(card()).toContainText('perro');
    await expect(card()).not.toContainText('gato');
    await page.keyboard.press('s');
    await expect(page.getByText('No cards left.')).toBeVisible();
  });

  test('edit saves a field and a script is not an element', async () => {
    const deckId = await createDeck(page, 'Study Edit');
    await addNote(page, deckId, 'gato', 'cat');
    await openStudy(page, deckId);
    await page.keyboard.press('e');
    await expect(editDialog()).toBeVisible();
    const field = page.getByLabel('Field 1');
    await expect(field).toBeFocused();
    await field.fill('gato-edit');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(editDialog()).toBeHidden();
    await expect(card()).toContainText('gato-edit');
    await page.keyboard.press('e');
    await field.fill('<script>alert(1)</script>');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(editDialog()).toBeHidden();
    await expect(card().locator('script')).toHaveCount(0);
    await expect(card()).toContainText('alert(1)');
    await page.keyboard.press('e');
    await field.fill('<svg><script>alert(1)</script></svg><img src=x onerror=alert(1)>');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(editDialog()).toBeHidden();
    await expect(card().locator('script, svg, img, iframe, object, embed')).toHaveCount(0);
    await page.keyboard.press('e');
    await field.fill('nope');
    await page.keyboard.press('Escape');
    await expect(editDialog()).toBeHidden();
    await expect(card()).toContainText('alert(1)');
    await expect(card()).not.toContainText('nope');
  });

  test('edit dialog keys stay in the dialog and do not rate', async () => {
    const deckId = await createDeck(page, 'Study Keys');
    await addNote(page, deckId, 'gato', 'cat');
    await openStudy(page, deckId);
    await page.keyboard.press('e');
    await expect(page.getByLabel('Field 1')).toBeFocused();
    await page.keyboard.type('abc');
    for (const name of ['1', '2', '3', '4', 'u', 's', 'e']) {
      await page.keyboard.press(name);
    }
    await expect(page.getByLabel('Field 1')).toHaveValue(/abc1234use/);
    await expect(card()).toContainText('gato');
    for (let step = 0; step < 6; step += 1) {
      await page.keyboard.press('Tab');
      await expect(editDialog().locator(':focus')).toHaveCount(1);
    }
    await page.keyboard.press('Control+k');
    await expect(commands()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(commands()).toBeHidden();
    await expect(editDialog()).toBeVisible();
    await page.getByLabel('Field 1').click();
    await page.keyboard.press(':');
    await expect(page.getByLabel('Field 1')).toHaveValue(/:/);
    await expect(commands()).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(editDialog()).toBeHidden();
    await expect(card()).toContainText('gato');
    await expect(card()).not.toContainText('abc');
  });

  test('mobile Good is at least 44px and a click rates it', async () => {
    const deckId = await createDeck(page, 'Study Phone');
    await addNote(page, deckId, 'gato', 'cat');
    await page.setViewportSize({ width: 360, height: 800 });
    await openStudy(page, deckId);
    await page.getByRole('button', { name: 'Reveal' }).click();
    const good = page.getByRole('button', { name: /^Good / });
    const box = await good.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
    await page.setExtraHTTPHeaders(studyClockHeader());
    try {
      await good.click();
      await expect(page.getByText('Next card at')).toBeVisible();
    } finally {
      await page.setExtraHTTPHeaders({});
      await page.setViewportSize({ width: 1440, height: 900 });
    }
  });

  test('edit blocks suspend and undo and returns focus', async () => {
    const deckId = await createDeck(page, 'Study Lock');
    await addNote(page, deckId, 'gato', 'cat');
    await addNote(page, deckId, 'perro', 'dog');
    await openStudy(page, deckId);
    const edit = page.getByRole('button', { name: 'Edit' });
    await edit.click();
    await expect(editDialog()).toBeVisible();
    await expect(page.getByLabel('Field 1')).toBeFocused();
    await expect(page.getByRole('button', { name: 'Suspend' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await page.keyboard.press('Shift+Tab');
    await expect(editDialog().locator(':focus')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(editDialog()).toBeHidden();
    await expect(edit).toBeFocused();
    await expect(card()).toContainText('gato');
    await expect(card()).not.toContainText('perro');
  });

  test('a bad deck id does not call the study API', async () => {
    const hits: string[] = [];
    const onRequest = (req: Request): void => {
      if (req.url().includes('/api/study/')) {
        hits.push(req.url());
      }
    };
    page.on('request', onRequest);
    await page.goto('/study?deck=not-a-uuid');
    await expect(page.getByText('That deck id is not valid.')).toBeVisible();
    await page.goto('/study?deck=../x');
    await expect(page.getByText('That deck id is not valid.')).toBeVisible();
    expect(hits).toEqual([]);
    page.off('request', onRequest);
  });

  test('the deck list Study link opens that deck', async () => {
    await page.goto('/');
    await page.getByRole('treeitem', { name: /Study Queue/ }).click();
    const link = page.getByRole('link', { name: 'Study' });
    const href = await link.getAttribute('href');
    expect(href).toContain('/study?deck=');
    await link.click();
    await expect(page).toHaveURL(/\/study\?deck=/);
    await expect(page.getByRole('heading', { name: 'Study' })).toBeVisible();
  });
});
