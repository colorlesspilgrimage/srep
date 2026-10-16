import { expect, type Page } from '@playwright/test';
import { E2E_ORIGIN } from './cli';

export const BASIC_ID = '00000000-0000-4000-8000-000000000011';

type DeckRow = { id: string; name: string; parentId: string | null };

export async function csrf(page: Page): Promise<string> {
  const status = await page.request.get('/api/auth/status');
  const body: { csrfToken: string } = await status.json();
  return body.csrfToken;
}

export async function removeRootDecks(page: Page): Promise<void> {
  const listed = await page.request.get('/api/decks');
  const body: { decks: DeckRow[] } = await listed.json();
  const roots = body.decks.filter((deck) => deck.parentId === null);
  if (roots.length === 0) {
    return;
  }
  const token = await csrf(page);
  for (const deck of roots) {
    const response = await page.request.delete(`/api/decks/${deck.id}`, {
      headers: jsonHeaders(token),
      data: { action: 'trash' },
    });
    expect(response.ok()).toBeTruthy();
  }
}

function jsonHeaders(token: string): Record<string, string> {
  return {
    origin: E2E_ORIGIN,
    'x-srep-csrf': token,
    'content-type': 'application/json',
  };
}

export async function createDeck(page: Page, name: string): Promise<string> {
  const response = await page.request.post('/api/decks', {
    headers: jsonHeaders(await csrf(page)),
    data: { name },
  });
  expect(response.status()).toBe(201);
  const body: { deck: { id: string } } = await response.json();
  return body.deck.id;
}

export async function addNote(
  page: Page,
  deckId: string,
  front: string,
  back: string,
): Promise<void> {
  const response = await page.request.post('/api/notes', {
    headers: jsonHeaders(await csrf(page)),
    data: { noteTypeId: BASIC_ID, deckId, fields: [front, back], tags: [] },
  });
  expect(response.status()).toBe(201);
}

// Undo reads the newest review row in the database. An earlier run can leave one.
// This call repeats until the API says there is nothing to undo.
export async function drainUndo(page: Page): Promise<void> {
  const token = await csrf(page);
  for (let step = 0; step < 100; step += 1) {
    const response = await page.request.post('/api/study/undo', {
      headers: jsonHeaders(token),
      data: {},
    });
    if (response.status() === 404) {
      return;
    }
    expect(response.ok()).toBeTruthy();
  }
  throw new Error('The undo list was still not empty.');
}

export async function openStudy(page: Page, deckId: string): Promise<void> {
  const response = await page.goto(`/study?deck=${encodeURIComponent(deckId)}`);
  await page.waitForFunction(() => document.body.classList.contains('tui-page'));
  expect(response?.headers()['cache-control']).toBe('no-store');
  await expect(page.getByRole('heading', { name: 'Study', level: 1 })).toBeVisible();
  await expect(page.locator('.tui-theme-phosphor-green')).toBeVisible();
}

export function untilText(ms: number): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ms));
}
