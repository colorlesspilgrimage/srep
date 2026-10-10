import type { CredentialKind } from '#lib/server/auth/webauthn.js';

export type CredentialRow = {
  id: string;
  credentialId: string;
  publicKey: string;
  signCount: number;
  transports: string[];
  kind: CredentialKind;
  nickname: string;
  createdAt: number;
  lastUsedAt: number | null;
};

export type SessionRow = {
  id: string;
  tokenHash: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  userAgent: string;
};

export type ChallengePurpose = 'setup' | 'register' | 'login';

export type ChallengeRow = {
  id: string;
  challenge: string;
  purpose: ChallengePurpose;
  expiresAt: number;
};

export type RecoveryRow = { id: string; codeHash: string };

export type CompleteSetupInput = {
  credential: CredentialRow;
  recoveryHashes: RecoveryRow[];
  session: SessionRow;
  now: number;
};

export type DeleteCredentialResult = 'deleted' | 'not_found' | 'last_credential';

export interface AuthStore {
  isSetupComplete(): Promise<boolean>;
  getSetupTokenHash(): Promise<string | null>;
  /** Returns the stored user handle. It stores `candidate` first when none exists. */
  getOrCreateUserId(candidate: string): Promise<string>;
  completeSetup(input: CompleteSetupInput): Promise<{ ok: true } | { ok: false; reason: 'locked' }>;
  armSetup(tokenHash: string): Promise<void>;
  resetAuth(input: { tokenHash: string }): Promise<void>;

  listCredentials(): Promise<CredentialRow[]>;
  getCredentialByCredentialId(credentialId: string): Promise<CredentialRow | undefined>;
  getCredentialById(id: string): Promise<CredentialRow | undefined>;
  insertCredential(credential: CredentialRow): Promise<void>;
  renameCredential(id: string, nickname: string): Promise<boolean>;
  deleteCredentialUnlessLast(id: string): Promise<DeleteCredentialResult>;
  updateSignCount(id: string, signCount: number, lastUsedAt: number): Promise<void>;

  insertChallenge(challenge: ChallengeRow): Promise<void>;
  consumeChallenge(id: string): Promise<ChallengeRow | undefined>;
  pruneChallenges(now: number): Promise<void>;

  listUnusedRecovery(): Promise<RecoveryRow[]>;
  consumeRecovery(id: string, now: number): Promise<boolean>;

  insertSession(session: SessionRow): Promise<void>;
  getSessionByTokenHash(tokenHash: string): Promise<SessionRow | undefined>;
  touchSession(id: string, now: number): Promise<void>;
  deleteSession(id: string): Promise<void>;
  deleteAllSessions(): Promise<void>;
  deleteExpiredSessions(now: number, idleMs: number): Promise<void>;
}

export const SETTING_SETUP_COMPLETE = 'auth.setup_complete';
export const SETTING_SETUP_TOKEN_HASH = 'auth.setup_token_hash';
export const SETTING_USER_ID = 'auth.user_id';
