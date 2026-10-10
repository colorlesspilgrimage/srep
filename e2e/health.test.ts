import { expect, test } from '@playwright/test';

test('GET /healthz returns ok', async ({ request }) => {
  const response = await request.get('/healthz');
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(await response.json()).toEqual({ status: 'ok' });
});

test('GET / redirects when not signed in', async ({ request }) => {
  const response = await request.get('/', { maxRedirects: 0 });
  expect(response.status()).toBe(303);
  expect(response.headers()['location']).toMatch(/\/(setup|login)$/);
});

test('GET /nope redirects when not signed in', async ({ request }) => {
  // Unknown pages need a session like every other page. The 404 comes after sign-in.
  const response = await request.get('/nope', { maxRedirects: 0 });
  expect(response.status()).toBe(303);
});

test('HEAD /healthz returns 200', async ({ request }) => {
  const response = await request.head('/healthz');
  expect(response.status()).toBe(200);
});
