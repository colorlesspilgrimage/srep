import { expect, test } from '@playwright/test';

test('GET /healthz returns ok', async ({ request }) => {
  const response = await request.get('/healthz');
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(await response.json()).toEqual({ status: 'ok' });
});

test('GET / is a blank page', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle('srep');
  await expect(page.locator('main')).toHaveText('');
});

test('GET /nope returns 404', async ({ request }) => {
  const response = await request.get('/nope');
  expect(response.status()).toBe(404);
});

test('HEAD /healthz returns 200', async ({ request }) => {
  const response = await request.head('/healthz');
  expect(response.status()).toBe(200);
});
