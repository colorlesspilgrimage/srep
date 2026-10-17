import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { E2E_ORIGIN, resetAuthViaCli } from './support/cli';
import { studyClockHeader, studyClockMs } from './support/study-clock';
import { addAuthenticator, enableWebAuthn } from './support/virtual-authenticator';

// The e2e database keeps its rows across runs. Each deck name is unique, and every
// study call is scoped to that deck.
let counter = 0;
const unique = (name: string) => `${name}-${process.pid}-${(counter += 1)}`;
let clockHeaders: Record<string, string> = {};

const BASIC_ID = '00000000-0000-4000-8000-000000000011';

type StudyCard = { id: string; reps: number; previews: Record<string, { due: number }> };
type NextReply = { status: string; card?: StudyCard; until?: number };

test.describe.serial('study engine', () => {
  let context: BrowserContext;
  let page: Page;
  let deckId = '';
  let cardId = '';

  test.beforeAll(async ({ browser }) => {
    const setupToken = resetAuthViaCli();
    context = await browser.newContext();
    page = await context.newPage();
    const cdp = await enableWebAuthn(page);
    await addAuthenticator(cdp, 'platform');
    await page.goto('/setup');
    await page.getByLabel('Setup token').fill(setupToken);
    await page.getByLabel('Nickname').fill('Study');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Save these codes now. They are shown once.')).toBeVisible();
  });

  test.afterAll(async () => {
    await context.close();
  });

  async function headers() {
    const status = await page.request.get('/api/auth/status');
    const { csrfToken }: { csrfToken: string } = await status.json();
    return {
      origin: E2E_ORIGIN,
      'x-srep-csrf': csrfToken,
      'content-type': 'application/json',
      ...clockHeaders,
    };
  }

  async function post<T>(path: string, data: unknown, expected = 200): Promise<T> {
    const response = await page.request.post(path, { headers: await headers(), data });
    expect(response.status(), path).toBe(expected);
    return response.json();
  }

  async function next(): Promise<NextReply> {
    const response = await page.request.get(`/api/study/next?deckId=${deckId}`, {
      headers: clockHeaders,
    });
    expect(response.status()).toBe(200);
    return response.json();
  }

  test('1. the study routes need a session', async ({ request }) => {
    expect((await request.get('/api/study/next')).status()).toBe(401);
    const answer = await request.post('/api/study/answer', {
      headers: { origin: E2E_ORIGIN, 'content-type': 'application/json' },
      data: {},
    });
    expect(answer.status()).toBe(401);
  });

  test('2. next gives the new card with four previews', async () => {
    const { deck } = await post<{ deck: { id: string } }>(
      '/api/decks',
      { name: unique('Study') },
      201,
    );
    deckId = deck.id;
    const { note } = await post<{ note: { cards: { id: string }[] } }>(
      '/api/notes',
      { noteTypeId: BASIC_ID, deckId, fields: ['猫', 'cat'], tags: ['study'] },
      201,
    );
    cardId = note.cards[0]?.id ?? '';
    const reply = await next();
    expect(reply.status).toBe('card');
    expect(reply.card?.id).toBe(cardId);
    expect(Object.keys(reply.card?.previews ?? {})).toEqual(['1', '2', '3', '4']);
  });

  test('3. an answer moves the card to learning, so next waits about 10 minutes', async () => {
    const before = studyClockMs();
    clockHeaders = studyClockHeader();
    try {
      await post('/api/study/answer', { cardId, rating: 3, reps: 0, elapsedMs: 4000 });
      const reply = await next();
      expect(reply.status).toBe('wait');
      const minutes = ((reply.until ?? 0) - before) / 60_000;
      expect(minutes).toBeGreaterThan(9);
      expect(minutes).toBeLessThan(11);
    } finally {
      clockHeaders = {};
    }
  });

  test('4. undo brings the card back with the same reps', async () => {
    const result = await post<{ undone: { cardId: string } }>('/api/study/undo', {});
    expect(result.undone.cardId).toBe(cardId);
    const reply = await next();
    expect(reply.status).toBe('card');
    expect(reply.card).toMatchObject({ id: cardId, reps: 0 });
  });

  test('5. a suspended card leaves the queue until unsuspend', async () => {
    await post('/api/cards/suspend', { cardIds: [cardId] });
    expect((await next()).status).toBe('done');
    await post('/api/cards/unsuspend', { cardIds: [cardId] });
    expect((await next()).status).toBe('card');
  });

  test('6. the study day settings', async () => {
    const settings = { rolloverHour: 4, timezone: 'Europe/Berlin' };
    const put = await page.request.put('/api/settings/study', {
      headers: await headers(),
      data: settings,
    });
    expect(put.status()).toBe(200);
    const read = await page.request.get('/api/settings/study');
    expect(await read.json()).toEqual({ settings });
    const bad = await page.request.put('/api/settings/study', {
      headers: await headers(),
      data: { rolloverHour: 4, timezone: 'Mars/Base' },
    });
    expect(bad.status()).toBe(400);
  });

  test('7. verify finds no mismatch', async () => {
    await post('/api/study/answer', { cardId, rating: 3, reps: 0, elapsedMs: 2000 });
    const response = await page.request.get('/api/study/verify');
    expect(response.status()).toBe(200);
    const report: { mismatches: unknown[]; chainMismatches: unknown[] } = await response.json();
    expect(report.mismatches).toEqual([]);
    expect(report.chainMismatches).toEqual([]);
  });
});
