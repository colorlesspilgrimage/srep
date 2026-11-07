import type { AuthDeps, Result } from '#lib/server/auth/deps.js';
import {
  MAX_API_TOKENS,
  PAIRING_CODE_LENGTH,
  PAIRING_CODE_TTL_MS,
} from '#lib/server/auth/pairing-policy.js';
import { isShortText } from '#lib/server/auth/short-text.js';
import type { ApiTokenRow, PairingCodeRow } from '#lib/server/auth/store-types.js';
import { randomToken, sha256Hex, type RandomBytes } from '#lib/server/auth/tokens.js';

// Crockford base32 without I, L, O and U — same alphabet as recovery codes.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export type PairingQrPayload = {
  v: 1;
  origin: string;
  code: string;
};

export type CreatedPairingCode = {
  code: string;
  expiresAt: number;
  qrPayload: PairingQrPayload;
};

export type ExchangedToken = {
  token: string;
  tokenId: string;
  name: string;
};

function randomPairingCode(random: RandomBytes): string {
  const bytes = random(PAIRING_CODE_LENGTH);
  let out = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i += 1) {
    out += ALPHABET[(bytes[i] ?? 0) % ALPHABET.length];
  }
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

export function normalizePairingCode(input: string): string | null {
  const mapped = input
    .trim()
    .toUpperCase()
    .replace(/[-\s]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  if (mapped.length !== PAIRING_CODE_LENGTH) {
    return null;
  }
  for (const char of mapped) {
    if (!ALPHABET.includes(char)) {
      return null;
    }
  }
  return mapped;
}

export function formatPairingCode(normalized: string): string {
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

export function hashPairingCode(code: string): string | null {
  const normalized = normalizePairingCode(code);
  if (normalized === null) {
    return null;
  }
  return sha256Hex(normalized);
}

function buildBearerToken(random: RandomBytes): string {
  return `srep_${randomToken(32, random)}`;
}

function defaultDeviceName(now: number): string {
  return `iOS device ${new Date(now).toISOString().slice(0, 10)}`;
}

export async function createPairingCode(
  deps: AuthDeps,
  input: { name?: string } = {},
): Promise<Result<CreatedPairingCode>> {
  const name = (input.name ?? '').trim();
  const deviceName = name === '' ? defaultDeviceName(deps.now()) : name;
  if (!isShortText(deviceName)) {
    return { ok: false, status: 400, error: 'invalid_nickname' };
  }
  await deps.store.prunePairingCodes(deps.now());
  const now = deps.now();
  await deps.store.invalidateOpenPairingCodes(now);
  const code = randomPairingCode(deps.random);
  const codeHash = hashPairingCode(code);
  if (codeHash === null) {
    return { ok: false, status: 500, error: 'pairing_failed' };
  }
  const row: PairingCodeRow = {
    id: crypto.randomUUID(),
    codeHash,
    name: deviceName,
    createdAt: now,
    expiresAt: now + PAIRING_CODE_TTL_MS,
    consumedAt: null,
  };
  await deps.store.insertPairingCode(row);
  const qrPayload: PairingQrPayload = { v: 1, origin: deps.auth.origin, code };
  return { ok: true, code, expiresAt: row.expiresAt, qrPayload };
}

export async function exchangePairingCode(
  deps: AuthDeps,
  input: { code: string; name?: string },
): Promise<Result<ExchangedToken>> {
  await deps.store.prunePairingCodes(deps.now());
  const codeHash = hashPairingCode(input.code);
  if (codeHash === null) {
    return { ok: false, status: 401, error: 'pairing_failed' };
  }
  const now = deps.now();
  const open = await deps.store.getOpenPairingCodeByHash(codeHash, now);
  if (open === undefined) {
    return { ok: false, status: 401, error: 'pairing_failed' };
  }
  if ((await deps.store.countActiveApiTokens()) >= MAX_API_TOKENS) {
    return { ok: false, status: 409, error: 'token_limit' };
  }
  const override = (input.name ?? '').trim();
  const deviceName = override === '' ? open.name : override;
  if (!isShortText(deviceName)) {
    return { ok: false, status: 400, error: 'invalid_nickname' };
  }
  const consumed = await deps.store.consumePairingCode(open.id, now);
  if (!consumed) {
    return { ok: false, status: 401, error: 'pairing_failed' };
  }
  const rawToken = buildBearerToken(deps.random);
  const row: ApiTokenRow = {
    id: crypto.randomUUID(),
    tokenHash: sha256Hex(rawToken),
    name: deviceName,
    createdAt: now,
    lastUsedAt: now,
    revokedAt: null,
  };
  await deps.store.insertApiToken(row);
  return { ok: true, token: rawToken, tokenId: row.id, name: row.name };
}
