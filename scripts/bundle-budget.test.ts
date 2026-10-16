import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  setCsrfToken: vi.fn(),
  register: vi.fn(),
  authenticate: vi.fn(),
}));

vi.mock('#lib/client/api.js', () => ({
  apiFetch: hoisted.apiFetch,
  setCsrfToken: hoisted.setCsrfToken,
}));

vi.mock('#lib/client/webauthn.js', () => ({
  register: hoisted.register,
  authenticate: hoisted.authenticate,
}));

import { enroll, loginWith } from '#lib/client/ceremonies.js';
import { signOut } from '#lib/client/sign-out.js';
import { budgetResult, clientJsGzipBytes, gzipLimit } from './bundle-budget.mjs';

const dirs: string[] = [];

afterEach(() => {
  hoisted.apiFetch.mockReset();
  hoisted.setCsrfToken.mockReset();
  hoisted.register.mockReset();
  hoisted.authenticate.mockReset();
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function clientDir(): string {
  const dir = path.join(os.tmpdir(), `srep-budget-${dirs.length}-${process.pid}`);
  mkdirSync(path.join(dir, '_app', 'immutable', 'chunks'), { recursive: true });
  dirs.push(dir);
  return dir;
}

function noise(size: number): Buffer {
  const out = Buffer.alloc(size);
  let state = 1;
  for (let index = 0; index < size; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[index] = state >>> 24;
  }
  return out;
}

describe('bundle budget', () => {
  it('reads the cap from the json file', () => {
    expect(gzipLimit()).toBe(90000);
  });

  it('accepts a small client and rejects a large client', () => {
    const small = clientDir();
    writeFileSync(path.join(small, '_app', 'immutable', 'app.js'), 'var a=1;');
    writeFileSync(path.join(small, '_app', 'immutable', 'chunks', 'b.js'), 'var b=2;');
    writeFileSync(path.join(small, '_app', 'immutable', 'skip.txt'), 'nope');
    const under = budgetResult(small);
    expect(under.ok).toBe(true);
    expect(under.bytes).toBe(clientJsGzipBytes(small));
    const large = clientDir();
    writeFileSync(path.join(large, '_app', 'immutable', 'big.js'), noise(200_000));
    expect(budgetResult(large).ok).toBe(false);
    expect(budgetResult(path.join(os.tmpdir(), 'srep-budget-missing')).ok).toBe(false);
  });

  it('keeps sign-out off the home import of the passkey package', () => {
    const home = readFileSync(path.resolve('src/routes/+page.svelte'), 'utf8');
    const signOutFile = readFileSync(path.resolve('src/lib/client/sign-out.ts'), 'utf8');
    const gallery = readFileSync(path.resolve('src/routes/gallery/+page.svelte'), 'utf8');
    expect(home.includes('ceremonies')).toBe(false);
    expect(home.includes('@simplewebauthn/browser')).toBe(false);
    expect(home.includes('sign-out')).toBe(true);
    expect(signOutFile.includes('@simplewebauthn/browser')).toBe(false);
    expect(gallery.includes('ceremonies')).toBe(false);
  });

  it('covers enroll, login, and sign-out', async () => {
    hoisted.apiFetch.mockResolvedValueOnce({ ok: false, error: 'unknown_code' });
    expect(await enroll('/api/auth/setup', { kind: 'passkey', nickname: 'a' })).toMatchObject({
      ok: false,
    });
    hoisted.apiFetch.mockResolvedValueOnce({
      ok: true,
      body: { options: {}, challengeId: 'c' },
    });
    hoisted.register.mockResolvedValueOnce({ ok: false, message: 'cancelled' });
    expect(await enroll('/api/auth/credentials', { kind: 'security_key', nickname: 'b' })).toEqual({
      ok: false,
      message: 'cancelled',
    });
    hoisted.apiFetch.mockResolvedValueOnce({
      ok: true,
      body: { options: {}, challengeId: 'c' },
    });
    hoisted.register.mockResolvedValueOnce({ ok: true, value: { id: 'r' } });
    hoisted.apiFetch.mockResolvedValueOnce({ ok: false, error: 'verification_failed' });
    expect(await enroll('/api/auth/setup', { kind: 'passkey', nickname: 'a' })).toMatchObject({
      ok: false,
    });
    hoisted.apiFetch.mockResolvedValueOnce({
      ok: true,
      body: { options: {}, challengeId: 'c' },
    });
    hoisted.register.mockResolvedValueOnce({ ok: true, value: { id: 'r' } });
    hoisted.apiFetch.mockResolvedValueOnce({ ok: true, body: { id: 'user' } });
    expect(await enroll('/api/auth/setup', { kind: 'passkey', nickname: 'a' })).toMatchObject({
      ok: true,
    });

    hoisted.apiFetch.mockResolvedValueOnce({ ok: false, error: 'login_failed' });
    expect(await loginWith('passkey')).toMatchObject({ ok: false });
    hoisted.apiFetch.mockResolvedValueOnce({
      ok: true,
      body: { options: {}, challengeId: 'c' },
    });
    hoisted.authenticate.mockResolvedValueOnce({ ok: false, message: 'cancelled' });
    expect(await loginWith('security_key')).toEqual({ ok: false, message: 'cancelled' });
    hoisted.apiFetch.mockResolvedValueOnce({
      ok: true,
      body: { options: {}, challengeId: 'c' },
    });
    hoisted.authenticate.mockResolvedValueOnce({ ok: true, value: { id: 'a' } });
    hoisted.apiFetch.mockResolvedValueOnce({ ok: false, error: 'verification_failed' });
    expect(await loginWith('passkey')).toMatchObject({ ok: false });
    hoisted.apiFetch.mockResolvedValueOnce({
      ok: true,
      body: { options: {}, challengeId: 'c' },
    });
    hoisted.authenticate.mockResolvedValueOnce({ ok: true, value: { id: 'a' } });
    hoisted.apiFetch.mockResolvedValueOnce({ ok: true, body: { csrfToken: 'tok' } });
    expect(await loginWith('passkey')).toEqual({ ok: true, body: null });
    expect(hoisted.setCsrfToken).toHaveBeenCalledWith('tok');

    hoisted.apiFetch.mockResolvedValue({ ok: true, body: {} });
    await signOut(false);
    await signOut(true);
    expect(hoisted.apiFetch).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
    expect(hoisted.apiFetch).toHaveBeenCalledWith('/api/auth/logout-all', { method: 'POST' });
    expect(hoisted.setCsrfToken).toHaveBeenCalledWith(null);
  });
});
