import type { AuthConfig } from '#lib/server/auth/rp-config.js';
import type { AuthStore } from '#lib/server/auth/store.js';
import type { RandomBytes } from '#lib/server/auth/tokens.js';
import type { WebAuthnPort } from '#lib/server/auth/webauthn.js';

export type AuthLogger = {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
};

export type AuthDeps = {
  store: AuthStore;
  webauthn: WebAuthnPort;
  auth: AuthConfig;
  now: () => number;
  random: RandomBytes;
  logger: AuthLogger;
};

export type Failure = { ok: false; status: number; error: string };
export type Result<T extends object> = ({ ok: true } & T) | Failure;

export function fail(status: number, error: string): Failure {
  return { ok: false, status, error };
}
