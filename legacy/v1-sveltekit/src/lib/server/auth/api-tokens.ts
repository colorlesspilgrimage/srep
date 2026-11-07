import type { AuthDeps, Failure } from '#lib/server/auth/deps.js';
import { API_TOKEN_TOUCH_MS } from '#lib/server/auth/pairing-policy.js';
import { isShortText } from '#lib/server/auth/short-text.js';
import type { ApiTokenRow } from '#lib/server/auth/store-types.js';
import { sha256Hex } from '#lib/server/auth/tokens.js';

export type ApiTokenView = {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
};

export function toApiTokenView(row: ApiTokenRow): ApiTokenView {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
  };
}

export async function listApiTokens(deps: AuthDeps): Promise<ApiTokenView[]> {
  const rows = await deps.store.listApiTokens();
  return rows.map(toApiTokenView);
}

export async function renameApiToken(
  deps: AuthDeps,
  id: string,
  name: string,
): Promise<{ ok: true } | Failure> {
  if (!isShortText(name)) {
    return { ok: false, status: 400, error: 'invalid_nickname' };
  }
  const renamed = await deps.store.renameApiToken(id, name);
  if (!renamed) {
    return { ok: false, status: 404, error: 'not_found' };
  }
  return { ok: true };
}

export async function revokeApiToken(deps: AuthDeps, id: string): Promise<{ ok: true } | Failure> {
  const revoked = await deps.store.revokeApiToken(id, deps.now());
  if (!revoked) {
    return { ok: false, status: 404, error: 'not_found' };
  }
  return { ok: true };
}

/** Resolves a raw Bearer token to an active api_token row, or null. */
export async function resolveApiToken(
  deps: AuthDeps,
  rawToken: string,
): Promise<ApiTokenRow | null> {
  if (!rawToken.startsWith('srep_') || rawToken.length < 20) {
    return null;
  }
  const row = await deps.store.getApiTokenByTokenHash(sha256Hex(rawToken));
  if (row === undefined || row.revokedAt !== null) {
    return null;
  }
  const now = deps.now();
  const last = row.lastUsedAt ?? row.createdAt;
  if (now - last >= API_TOKEN_TOUCH_MS) {
    await deps.store.touchApiToken(row.id, now);
    return { ...row, lastUsedAt: now };
  }
  return row;
}

export function readBearerToken(authorizationHeader: string | null): string | null {
  if (authorizationHeader === null || authorizationHeader === '') {
    return null;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(authorizationHeader.trim());
  return match?.[1] ?? null;
}
