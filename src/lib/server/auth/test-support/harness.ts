import crypto from 'node:crypto';
import type { AuthDeps } from '#lib/server/auth/deps.js';
import type { AuthStore } from '#lib/server/auth/store-types.js';
import { getAuthStore } from '#lib/server/auth/store.js';
import type { VerifiedRegistration, WebAuthnPort } from '#lib/server/auth/webauthn.js';
import { WebAuthnError } from '#lib/server/auth/webauthn.js';
import { sql } from 'drizzle-orm';
import { parseConfig, type Config } from '#lib/server/config.js';
import { createDb, type DbHandle } from '#lib/server/db/client.js';
import { runMigrations } from '#lib/server/db/migrate.js';

export type Clock = { now: number };

export type FakeWebAuthn = WebAuthnPort & {
  /** Next result of verifyRegistration. An error value makes it throw. */
  registration: VerifiedRegistration | 'fail';
  /** Next result of verifyAuthentication. */
  authentication: { newSignCount: number } | 'fail' | 'replay';
  lastAllow: { credentialId: string; transports: string[] }[] | undefined;
  lastChallenge: string;
  verifiedWith: string[];
};

export function createFakeWebAuthn(): FakeWebAuthn {
  let counter = 0;
  const fake: FakeWebAuthn = {
    registration: {
      credentialId: 'cred-default',
      publicKey: 'pk',
      signCount: 0,
      transports: ['internal'],
    },
    authentication: { newSignCount: 1 },
    lastAllow: undefined,
    lastChallenge: '',
    verifiedWith: [],
    async registrationOptions({ auth }) {
      counter += 1;
      fake.lastChallenge = `challenge-${counter}`;
      return {
        rp: { id: auth.rpId, name: auth.rpName },
        user: { id: 'u', name: 'srep', displayName: 'srep owner' },
        challenge: fake.lastChallenge,
        pubKeyCredParams: [],
      };
    },
    async verifyRegistration({ expectedChallenge }) {
      fake.verifiedWith.push(expectedChallenge);
      if (fake.registration === 'fail') {
        throw new WebAuthnError('verification_failed');
      }
      return fake.registration;
    },
    async authenticationOptions({ allow }) {
      counter += 1;
      fake.lastAllow = allow;
      fake.lastChallenge = `challenge-${counter}`;
      return {
        challenge: fake.lastChallenge,
        allowCredentials: allow?.map((c) => ({ id: c.credentialId, type: 'public-key' as const })),
      };
    },
    async verifyAuthentication({ expectedChallenge }) {
      fake.verifiedWith.push(expectedChallenge);
      if (fake.authentication === 'fail') {
        throw new WebAuthnError('verification_failed');
      }
      if (fake.authentication === 'replay') {
        throw new WebAuthnError('counter_replay');
      }
      return fake.authentication;
    },
  };
  return fake;
}

export type Harness = {
  deps: AuthDeps;
  store: AuthStore;
  handle: DbHandle;
  clock: Clock;
  webauthn: FakeWebAuthn;
  warnings: { obj: object; msg: string | undefined }[];
};

// Counter based bytes. The result is the same in every run.
export function seededRandom(): (size: number) => Buffer {
  let counter = 0;
  return (size) => {
    counter += 1;
    const out = Buffer.alloc(size);
    let offset = 0;
    for (let block = 0; offset < size; block += 1) {
      const digest = crypto.createHash('sha256').update(`seed-${counter}-${block}`).digest();
      digest.copy(out, offset);
      offset += digest.length;
    }
    return out;
  };
}

// Builds the harness on top of an open database. The store is real. WebAuthn is fake.
export function buildHarness(handle: DbHandle, config: Config): Harness {
  const store = getAuthStore(handle);
  const clock: Clock = { now: 1_000_000 };
  const webauthn = createFakeWebAuthn();
  const warnings: Harness['warnings'] = [];
  const deps: AuthDeps = {
    store,
    webauthn,
    auth: config.auth,
    now: () => clock.now,
    random: seededRandom(),
    logger: {
      info: () => undefined,
      warn: (obj, msg) => warnings.push({ obj, msg }),
    },
  };
  return { deps, store, handle, clock, webauthn, warnings };
}

// Real SQLite store in memory, fake WebAuthn, fixed clock, seeded random.
export async function createHarness(env: Record<string, string> = {}): Promise<Harness> {
  const config = parseConfig({ SREP_DATABASE_URL: 'sqlite::memory:', ...env });
  const handle = createDb(config);
  await runMigrations(handle, config, { info: () => undefined });
  return buildHarness(handle, config);
}

const AUTH_TABLES = [
  'auth_credential',
  'auth_recovery',
  'session',
  'auth_challenge',
  'app_settings',
];

// Real Postgres store. Every call starts with empty auth tables.
export async function createPgHarness(url: string): Promise<Harness> {
  const config = parseConfig({ SREP_DATABASE_URL: url });
  const handle = createDb(config);
  await runMigrations(handle, config, { info: () => undefined });
  if (handle.dialect === 'postgres') {
    await handle.db.execute(sql.raw(`truncate table ${AUTH_TABLES.join(', ')}`));
  }
  return buildHarness(handle, config);
}

export const SETUP_RESPONSE = { id: 'cred-default' } as never;

// Runs the full setup flow with the fake WebAuthn. Returns the secrets.
export async function doSetup(h: Harness, kind: 'passkey' | 'security_key' = 'passkey') {
  const { ensureSetupToken, setupOptions, setupVerify } = await import('#lib/server/auth/setup.js');
  const setupToken = (await ensureSetupToken(h.deps)) ?? '';
  const options = await setupOptions(h.deps, { setupToken, kind, nickname: 'Laptop' });
  if (!options.ok) {
    throw new Error(options.error);
  }
  const done = await setupVerify(h.deps, {
    setupToken,
    challengeId: options.challengeId,
    response: SETUP_RESPONSE,
    kind,
    nickname: 'Laptop',
    userAgent: 'test-agent',
  });
  if (!done.ok) {
    throw new Error(done.error);
  }
  return { setupToken, ...done };
}
