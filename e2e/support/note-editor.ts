import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { E2E_ORIGIN, resetAuthViaCli } from './cli';
import { createDeck, csrf, removeRootDecks } from './study-screen';
import { addAuthenticator, enableWebAuthn } from './virtual-authenticator';

export const NOTE_EDITOR_IP = '198.51.100.42';

export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export async function signInEditor(
  browser: Browser,
  address = NOTE_EDITOR_IP,
): Promise<{
  context: BrowserContext;
  page: Page;
}> {
  const setupToken = resetAuthViaCli();
  const context = await browser.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': address },
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const cdp = await enableWebAuthn(page);
  await addAuthenticator(cdp, 'platform');
  await page.goto('/setup');
  await page.getByLabel('Setup token').fill(setupToken);
  await page.getByLabel('Nickname').fill('Notes');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Save these codes now. They are shown once.')).toBeVisible();
  await removeRootDecks(page);
  return { context, page };
}

export async function openNewNote(page: Page, deckId: string): Promise<void> {
  const response = await page.goto(`/notes/new?deck=${encodeURIComponent(deckId)}`);
  await page.waitForFunction(() => document.body.classList.contains('tui-page'));
  expect(response?.headers()['cache-control']).toBe('no-store');
  await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
}

export async function postNote(
  page: Page,
  deckId: string,
  fields: string[],
  noteTypeId = '00000000-0000-4000-8000-000000000011',
): Promise<string> {
  const response = await page.request.post('/api/notes', {
    headers: {
      origin: E2E_ORIGIN,
      'x-srep-csrf': await csrf(page),
      'content-type': 'application/json',
    },
    data: { noteTypeId, deckId, fields, tags: ['animals'] },
  });
  expect(response.status()).toBe(201);
  const body: { note: { id: string } } = await response.json();
  return body.note.id;
}

export async function makeDecks(
  page: Page,
): Promise<{ alpha: string; beta: string; gamma: string }> {
  return {
    alpha: await createDeck(page, 'Alpha'),
    beta: await createDeck(page, 'Beta'),
    gamma: await createDeck(page, 'Gamma'),
  };
}
