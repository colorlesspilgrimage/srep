import crypto from 'node:crypto';
import type { AuthDeps } from '#lib/server/auth/deps.js';
import { createLimiters, type AuthLimiters } from '#lib/server/auth/limiters.js';
import { getAuthStore } from '#lib/server/auth/store.js';
import { webAuthn } from '#lib/server/auth/webauthn.js';
import { getConfig } from '#lib/server/config.js';
import { getDb } from '#lib/server/db/index.js';
import { getLogger } from '#lib/server/logger.js';
import { once } from '#lib/server/once.js';

export type AuthContext = { deps: AuthDeps; limiters: AuthLimiters };

export const getAuthContext = once((): AuthContext => {
  const deps: AuthDeps = {
    store: getAuthStore(getDb()),
    webauthn: webAuthn,
    auth: getConfig().auth,
    now: Date.now,
    random: crypto.randomBytes,
    logger: getLogger(),
  };
  return { deps, limiters: createLimiters(Date.now) };
});
