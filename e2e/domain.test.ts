import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { E2E_ORIGIN, resetAuthViaCli } from './support/cli';
import { addAuthenticator, enableWebAuthn } from './support/virtual-authenticator';

// The domain tables keep their rows across runs. Each name gets the process id and a counter.
let counter = 0;
const unique = (name: string) => `${name}-${process.pid}-${(counter += 1)}`;

const BASIC_ID = '00000000-0000-4000-8000-000000000011';
const BASIC_REVERSED_ID = '00000000-0000-4000-8000-000000000012';
const CLOZE_ID = '00000000-0000-4000-8000-000000000013';
// A valid 1x1 transparent PNG.
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c6360000200000500017a5eab3f0000000049454e44ae426082',
  'hex',
);

type Card = { front: string; back: string; deckId: string };
type Note = { id: string; cards: Card[]; tags: string[] };

test.describe.serial('decks, notes and media', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const setupToken = resetAuthViaCli();
    context = await browser.newContext();
    page = await context.newPage();
    const cdp = await enableWebAuthn(page);
    await addAuthenticator(cdp, 'platform');
    await page.goto('/setup');
    await page.getByLabel('Setup token').fill(setupToken);
    await page.getByLabel('Nickname').fill('Domain');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Save these codes now. They are shown once.')).toBeVisible();
  });

  test.afterAll(async () => {
    await context.close();
  });

  async function headers(extra: Record<string, string> = {}) {
    const status = await page.request.get('/api/auth/status');
    const { csrfToken }: { csrfToken: string } = await status.json();
    return { origin: E2E_ORIGIN, 'x-srep-csrf': csrfToken, ...extra };
  }

  async function post<T>(path: string, data: unknown, expected = 201): Promise<T> {
    const response = await page.request.post(path, { headers: await headers(), data });
    expect(response.status(), path).toBe(expected);
    return response.json();
  }

  test('1. the domain routes need a session', async ({ request }) => {
    for (const path of ['/api/decks', '/api/note-types', `/api/media/${'0'.repeat(64)}`]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(401);
    }
  });

  test('2. decks and notes give the expected cards', async () => {
    const { deck: root } = await post<{ deck: { id: string; path: string } }>('/api/decks', {
      name: unique('E2E'),
    });
    const { deck: child } = await post<{ deck: { id: string; path: string } }>('/api/decks', {
      name: 'Japanese',
      parentId: root.id,
    });
    expect(child.path).toBe(`${root.path}::Japanese`);

    const create = (noteTypeId: string, fields: string[]) =>
      post<{ note: Note }>('/api/notes', { noteTypeId, deckId: child.id, fields, tags: ['E2E'] });
    const basic = (await create(BASIC_ID, ['犬', 'dog'])).note;
    const reversed = (await create(BASIC_REVERSED_ID, ['犬', 'dog'])).note;
    const cloze = (await create(CLOZE_ID, ['{{c1::Tokyo}} is the capital of {{c2::Japan}}', '']))
      .note;
    expect([basic, reversed, cloze].map((n) => n.cards.length)).toEqual([1, 2, 2]);
    expect(basic.tags).toEqual(['e2e']);

    const read = await page.request.get(`/api/notes/${cloze.id}`);
    const { note }: { note: Note } = await read.json();
    expect(note.cards.map((c) => c.front)).toEqual([
      '<span class="cloze">[...]</span> is the capital of Japan',
      'Tokyo is the capital of <span class="cloze">[...]</span>',
    ]);

    const renamed = await page.request.patch(`/api/decks/${root.id}`, {
      headers: await headers(),
      data: { name: unique('Lang') },
    });
    const { decks }: { decks: { path: string }[] } = await renamed.json();
    expect(decks).toHaveLength(2);
    expect(decks[1]?.path).toBe(`${decks[0]?.path}::Japanese`);
  });

  test('3. media upload and download', async () => {
    const upload = await page.request.post('/api/media', {
      headers: await headers({ 'content-type': 'image/png', 'x-filename': 'dot.png' }),
      data: PNG,
    });
    // An earlier run can have stored the same bytes. Then the answer is 200.
    expect([200, 201]).toContain(upload.status());
    const { media }: { media: { sha256: string } } = await upload.json();
    const download = await page.request.get(`/api/media/${media.sha256}`);
    expect(download.status()).toBe(200);
    expect(Buffer.from(await download.body())).toEqual(PNG);
    expect(download.headers()['x-content-type-options']).toBe('nosniff');
    expect(download.headers()['content-security-policy']).toBe("sandbox; default-src 'none'");

    const svg = await page.request.post('/api/media', {
      headers: await headers({ 'content-type': 'image/svg+xml' }),
      data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    });
    expect(svg.status()).toBe(415);
  });
});
