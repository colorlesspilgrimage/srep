import { expect, test } from '@playwright/test';

test('GET /healthz returns ok', async ({ request }) => {
  const response = await request.get('/healthz');
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(await response.json()).toEqual({ status: 'ok' });
});

test('GET / serves the SPA shell when not signed in', async ({ request }) => {
  const response = await request.get('/');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/text\/html/);
  await expect(response.text()).resolves.toContain('srep');
});

test('unknown paths fall back to the SPA shell', async ({ request }) => {
  const response = await request.get('/nope');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/text\/html/);
});

test('HEAD /healthz returns 200', async ({ request }) => {
  const response = await request.head('/healthz');
  expect(response.status()).toBe(200);
});
