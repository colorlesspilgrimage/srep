import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { resetAuthViaCli } from './support/cli';
import {
  addNote,
  createDeck,
  csrf,
  drainUndo,
  openStudy,
  removeRootDecks,
} from './support/study-screen';
import { studyClockHeader } from './support/study-clock';
import { addAuthenticator, enableWebAuthn } from './support/virtual-authenticator';

const CLIENT_IP = '198.51.100.41';

test.describe.serial('study screen r11a', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const setupToken = resetAuthViaCli();
    context = await browser.newContext({
      extraHTTPHeaders: { 'x-forwarded-for': CLIENT_IP },
      viewport: { width: 1440, height: 900 },
    });
    page = await context.newPage();

    const cdp = await enableWebAuthn(page);
    await addAuthenticator(cdp, 'platform');

    await page.goto('/');

    const authHeaders = {
      origin: 'http://localhost:4173',
      'content-type': 'application/json',
    };
    const optionsResponse = await page.request.post('/api/auth/setup/options', {
      headers: authHeaders,
      data: { setupToken, nickname: 'R11a', kind: 'passkey' },
    });
    expect(optionsResponse.status()).toBe(200);
    const { options, challengeId } = await optionsResponse.json();

    const response = await page.evaluate(async (options) => {
      const fromBase64url = (value: string): ArrayBuffer => {
        const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64.padEnd(
          base64.length + ((4 - (base64.length % 4)) % 4),
          '=',
        );
        const binary = atob(padded);
        return Uint8Array.from(binary, (char) => char.charCodeAt(0)).buffer;
      };
      const toBase64url = (value: ArrayBuffer): string => {
        let binary = '';
        for (const byte of new Uint8Array(value)) {
          binary += String.fromCharCode(byte);
        }
        return btoa(binary)
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
      };

      const publicKey: PublicKeyCredentialCreationOptions = {
        ...(options.publicKey ?? options),
        challenge: fromBase64url(
          (options.publicKey ?? options).challenge,
        ),
        user: {
          ...(options.publicKey ?? options).user,
          id: fromBase64url((options.publicKey ?? options).user.id),
        },
        excludeCredentials: (
          (options.publicKey ?? options).excludeCredentials ?? []
        ).map((credential: { id: string }) => ({
          ...credential,
          id: fromBase64url(credential.id),
        })),
      };
      const credential = (await navigator.credentials.create({
        publicKey,
      })) as PublicKeyCredential;
      const attestation =
        credential.response as AuthenticatorAttestationResponse;

      return {
        id: credential.id,
        rawId: toBase64url(credential.rawId),
        type: credential.type,
        response: {
          attestationObject: toBase64url(attestation.attestationObject),
          clientDataJSON: toBase64url(attestation.clientDataJSON),
        },
        authenticatorAttachment: credential.authenticatorAttachment,
        clientExtensionResults: credential.getClientExtensionResults(),
      };
    }, options);

    const verifyResponse = await page.request.post('/api/auth/setup/verify', {
      headers: authHeaders,
      data: {
        setupToken,
        challengeId,
        response,
        kind: 'passkey',
        nickname: 'R11a',
      },
    });
    expect(verifyResponse.status()).toBe(200);

    await removeRootDecks(page);
    await drainUndo(page);
    await context.setExtraHTTPHeaders({
      'x-forwarded-for': CLIENT_IP,
      ...studyClockHeader(),
    });
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('one due card renders, answers, and advances', async () => {
    const deckId = await createDeck(page, 'R11a Queue');
    await addNote(page, deckId, 'gato', 'cat');
    await addNote(page, deckId, 'perro', 'dog');

    await openStudy(page, deckId);

    const card = page.locator('.study-card');
    await expect(card).toContainText('gato');
    // Back is not in the DOM before Reveal. (The BASIC template renders
    // the back as `{{Front}}<hr>{{Back}}`, so the revealed back contains
    // the front again plus an <hr> — assert on the .study-back container.)
    await expect(page.locator('.study-back')).toHaveCount(0);

    await page.getByRole('button', { name: 'Reveal', exact: true }).click();
    const back = page.locator('.study-back');
    await expect(back).toContainText('cat');
    await expect(back.locator('hr')).toHaveCount(1);
    await page.getByRole('button', { name: /^Good / }).click();

    await expect(card).toContainText('perro');
    await expect(card).not.toContainText('gato');

    await page.getByRole('button', { name: 'Reveal', exact: true }).click();
    await expect(page.locator('.study-back')).toContainText('dog');
    await page.getByRole('button', { name: /^Easy / }).click();

    await expect(page.getByText(/Available at/)).toBeVisible();

    // /api/study/verify is POST-only (GET returns 405) and, as a mutating
    // call with a session, needs origin + CSRF headers.
    const response = await page.request.post('/api/study/verify', {
      headers: {
        origin: 'http://localhost:4173',
        'x-srep-csrf': await csrf(page),
        'content-type': 'application/json',
        ...studyClockHeader(),
      },
    });
    expect(response.status()).toBe(200);
    // The endpoint wraps the report: { report: { checked, skipped,
    // mismatches, chainMismatches } }.
    const { report }: { report: { mismatches: unknown[]; chainMismatches: unknown[] } } =
      await response.json();
    expect(report.mismatches).toEqual([]);
    expect(report.chainMismatches).toEqual([]);
  });

  test('empty deck shows no cards left', async () => {
    const deckId = await createDeck(page, 'R11a Empty');
    await openStudy(page, deckId);
    await expect(page.getByText('No cards left.', { exact: true })).toBeVisible();
  });

  test('a bad deck id does not call the study API', async () => {
    const studyRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/study/')) {
        studyRequests.push(request.url());
      }
    });

    await page.goto('/study?deck=not-a-uuid');
    await expect(
      page.getByText('That deck id is not valid.', { exact: true }),
    ).toBeVisible();
    expect(studyRequests).toEqual([]);

    await page.goto('/study?deck=../x');
    await expect(
      page.getByText('That deck id is not valid.', { exact: true }),
    ).toBeVisible();
    expect(studyRequests).toEqual([]);
  });
});