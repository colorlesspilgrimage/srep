import { randomInt } from 'node:crypto';
import {
  expect,
  test,
  type APIResponse,
  type BrowserContext,
  type CDPSession,
  type Page,
} from '@playwright/test';
import { E2E_ORIGIN, resetAuthViaCli } from './support/cli';
import {
  addAuthenticator,
  enableWebAuthn,
  getCredentials,
  removeAuthenticator,
} from './support/virtual-authenticator';

const sameOrigin = { origin: E2E_ORIGIN };
// SvelteKit rejects a body-less mutating request that has no content-type, because adapter-node
// assumes https. Calls from the test send an empty JSON body, like the app does.

test.describe.serial('authentication', () => {
  let context: BrowserContext;
  let page: Page;
  let cdp: CDPSession;
  let platformId: string;
  let setupToken = '';
  let recoveryCodes: string[] = [];
  const consoleErrors: string[] = [];

  test.beforeAll(async ({ browser }) => {
    setupToken = resetAuthViaCli();
    context = await browser.newContext();
    page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });
    cdp = await enableWebAuthn(page);
    platformId = await addAuthenticator(cdp, 'platform');
  });

  test.afterAll(async () => {
    await context.close();
  });

  async function csrfToken(): Promise<string> {
    const response = await page.request.get('/api/auth/status');
    const body: { csrfToken: string } = await response.json();
    return body.csrfToken;
  }

  async function logOut(): Promise<void> {
    await page.goto('/security');
    await page.getByRole('button', { name: 'Log out', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
  }

  async function loginWithRecoveryCode(target: Page, code: string): Promise<void> {
    await target.goto('/login');
    await target.getByText('Use a recovery code').click();
    await target.getByLabel('Recovery code').fill(code);
    await target.getByRole('button', { name: 'Log in with code' }).click();
  }

  test('1. unauthenticated API requests return 401', async ({ request }) => {
    for (const path of ['/api/decks', '/api/auth/credentials', '/api/zzz']) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(401);
      expect(await response.json()).toEqual({ error: 'unauthenticated' });
    }
  });

  test('2. setup: wrong token fails, right token enrolls a passkey', async ({ request }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/setup$/);

    await page.getByLabel('Setup token').fill('wrong-token');
    await page.getByLabel('Nickname').fill('Laptop');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('alert')).toHaveText('The setup token is not correct.');
    const status = await request.get('/api/auth/status');
    expect(await status.json()).toEqual({ setupComplete: false, authenticated: false });

    await page.getByLabel('Setup token').fill(setupToken);
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Save these codes now. They are shown once.')).toBeVisible();
    const text = (await page.getByLabel('Recovery codes').textContent()) ?? '';
    recoveryCodes = text.trim().split('\n');
    expect(recoveryCodes).toHaveLength(10);
    for (const code of recoveryCodes) {
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
    }
    expect(await getCredentials(cdp, platformId)).toHaveLength(1);
  });

  test('3. setup is locked after it completes', async () => {
    await page.goto('/setup');
    await expect(page).toHaveURL(/\/$/);
    const response = await page.request.post('/api/auth/setup/options', {
      headers: sameOrigin,
      data: { setupToken, kind: 'passkey', nickname: 'Again' },
    });
    expect(response.status()).toBe(403);
    expect(await response.json()).toEqual({ error: 'setup_locked' });
  });

  test('4. log out, then log in with the passkey', async () => {
    await logOut();
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await page.getByRole('button', { name: 'Log in with a passkey' }).click();
    await expect(page.getByRole('heading', { name: 'srep' })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    const cookies = await context.cookies();
    const session = cookies.find((c) => c.name === 'srep_session');
    expect(session).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
  });

  test('5. add a security key, then log in with it', async () => {
    await page.goto('/security');
    await expect(
      page.getByRole('status').filter({ hasText: 'You have one credential' }),
    ).toBeVisible();
    const usbId = await addAuthenticator(cdp, 'usb');
    await page.getByLabel('Nickname for the new credential').fill('YubiKey');
    await page.getByRole('button', { name: 'Add a security key' }).click();
    await expect(page.getByRole('cell', { name: 'YubiKey', exact: true })).toBeVisible();
    await expect(page.getByRole('row')).toHaveCount(3);
    expect(await getCredentials(cdp, usbId)).toHaveLength(1);

    await logOut();
    await removeAuthenticator(cdp, platformId);
    await page.getByRole('button', { name: 'Log in with a security key' }).click();
    await expect(page.getByRole('heading', { name: 'srep' })).toBeVisible();
  });

  test('6. rename, revoke, and refuse to revoke the last credential', async () => {
    await page.goto('/security');
    await page.getByRole('button', { name: 'Rename YubiKey' }).click();
    await page.getByLabel('New nickname').fill('Backup key');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: 'Backup key', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Revoke Backup key' }).click();
    await page.getByRole('button', { name: 'Confirm revoke Backup key' }).click();
    await expect(page.getByRole('row')).toHaveCount(2);

    await page.getByRole('button', { name: 'Revoke Laptop' }).click();
    await page.getByRole('button', { name: 'Confirm revoke Laptop' }).click();
    await expect(page.getByRole('alert')).toHaveText('You cannot remove your last credential.');
    await expect(page.getByRole('cell', { name: 'Laptop', exact: true })).toBeVisible();

    const list = await page.request.get('/api/auth/credentials');
    const { credentials }: { credentials: { id: string }[] } = await list.json();
    const response = await page.request.delete(`/api/auth/credentials/${credentials[0]?.id}`, {
      headers: { ...sameOrigin, 'x-srep-csrf': await csrfToken() },
      data: {},
    });
    expect(response.status()).toBe(409);
    expect(await response.json()).toEqual({ error: 'last_credential' });
  });

  test('7. log out everywhere ends the other session', async ({ browser }) => {
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await loginWithRecoveryCode(otherPage, recoveryCodes[0] ?? '');
    await expect(otherPage).toHaveURL(/\/$/);
    expect((await otherPage.request.get('/api/auth/credentials')).status()).toBe(200);

    await page.goto('/security');
    await page.getByRole('button', { name: 'Log out everywhere' }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await otherPage.request.get('/api/auth/credentials')).status()).toBe(401);
    await other.close();
  });

  test('8. a recovery code works once', async () => {
    const code = recoveryCodes[1] ?? '';
    await loginWithRecoveryCode(page, code);
    await expect(page).toHaveURL(/\/$/);
    await logOut();
    await page.getByText('Use a recovery code').click();
    await page.getByLabel('Recovery code').fill(code);
    await page.getByRole('button', { name: 'Log in with code' }).click();
    await expect(page.getByRole('alert')).toHaveText(
      'The recovery code is not valid or was used before.',
    );
  });

  test('9. a wrong origin returns 403', async ({ request }) => {
    const response = await request.post('/api/auth/login/options', {
      headers: { origin: 'http://evil.example' },
      data: {},
    });
    expect(response.status()).toBe(403);
    expect(await response.json()).toEqual({ error: 'bad_origin' });
  });

  test('10. a signed-in POST without the CSRF header returns 403', async () => {
    await loginWithRecoveryCode(page, recoveryCodes[2] ?? '');
    await expect(page).toHaveURL(/\/$/);
    const denied = await page.request.post('/api/auth/logout', { headers: sameOrigin, data: {} });
    expect(denied.status()).toBe(403);
    expect(await denied.json()).toEqual({ error: 'bad_csrf' });
    const allowed = await page.request.post('/api/auth/logout', {
      headers: { ...sameOrigin, 'x-srep-csrf': await csrfToken() },
      data: {},
    });
    expect(allowed.status()).toBe(200);
  });

  test('11. security headers are present and the CSP blocks nothing', async ({ request }) => {
    const response = await request.get('/login');
    const headers = response.headers();
    const csp = headers['content-security-policy'] ?? '';
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['strict-transport-security']).toBeUndefined();
    expect(consoleErrors.filter((text) => /content security policy/i.test(text))).toEqual([]);
  });

  test('12. the rate limit returns 429 with Retry-After', async ({ request }) => {
    const address = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
    const responses: APIResponse[] = [];
    for (let i = 0; i < 21; i += 1) {
      responses.push(
        await request.post('/api/auth/login/options', {
          headers: { ...sameOrigin, 'x-forwarded-for': address },
          data: {},
        }),
      );
    }
    const blocked = responses.filter((r) => r.status() === 429);
    expect(blocked.length).toBeGreaterThan(0);
    expect(Number(blocked[0]?.headers()['retry-after'])).toBeGreaterThan(0);
    expect(responses.slice(0, 20).every((r) => r.status() !== 429)).toBe(true);
  });
});
