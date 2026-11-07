/** Pairing code lives five minutes, then the UI must mint a fresh one. */
export const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;

/** Touch lastUsedAt at most once a minute (same cadence as cookie sessions). */
export const API_TOKEN_TOUCH_MS = 60 * 1000;

/** Cap active (non-revoked) paired devices per instance. */
export const MAX_API_TOKENS = 20;

/** Crockford length before the hyphen (XXXX-XXXX → 8). */
export const PAIRING_CODE_LENGTH = 8;
