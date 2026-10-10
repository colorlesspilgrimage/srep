import { and, eq, lte, or, sql, isNull } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  SETTING_SETUP_COMPLETE,
  SETTING_SETUP_TOKEN_HASH,
  SETTING_USER_ID,
  type AuthStore,
  type CredentialRow,
  type DeleteCredentialResult,
} from '#lib/server/auth/store-types.js';
import {
  appSettings,
  authChallenge,
  authCredential,
  authRecovery,
  session,
  type JsonValue,
} from '#lib/server/db/schema/sqlite.js';

type Exec = Pick<BetterSQLite3Database, 'select' | 'insert' | 'delete' | 'update'>;

function readSetting(db: Exec, key: string): JsonValue | undefined {
  return db.select().from(appSettings).where(eq(appSettings.key, key)).get()?.value;
}

function writeSetting(db: Exec, key: string, value: JsonValue): void {
  db.insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } })
    .run();
}

function deleteSetting(db: Exec, key: string): void {
  db.delete(appSettings).where(eq(appSettings.key, key)).run();
}

export function createSqliteStore(db: BetterSQLite3Database): AuthStore {
  return {
    async isSetupComplete() {
      return readSetting(db, SETTING_SETUP_COMPLETE) === true;
    },

    async getSetupTokenHash() {
      const value = readSetting(db, SETTING_SETUP_TOKEN_HASH);
      return typeof value === 'string' ? value : null;
    },

    async getOrCreateUserId(candidate) {
      db.insert(appSettings)
        .values({ key: SETTING_USER_ID, value: candidate })
        .onConflictDoNothing()
        .run();
      return String(readSetting(db, SETTING_USER_ID));
    },

    async completeSetup({ credential, recoveryHashes, session: newSession }) {
      return db.transaction((tx) => {
        // The insert is the lock. A second setup finds the row and writes nothing.
        const lock = tx
          .insert(appSettings)
          .values({ key: SETTING_SETUP_COMPLETE, value: true })
          .onConflictDoNothing()
          .returning({ key: appSettings.key })
          .all();
        if (lock.length === 0) {
          return { ok: false as const, reason: 'locked' as const };
        }
        tx.insert(authCredential).values(credential).run();
        for (const row of recoveryHashes) {
          tx.insert(authRecovery).values({ id: row.id, codeHash: row.codeHash }).run();
        }
        deleteSetting(tx, SETTING_SETUP_TOKEN_HASH);
        tx.insert(session).values(newSession).run();
        return { ok: true as const };
      });
    },

    async armSetup(tokenHash) {
      db.transaction((tx) => {
        if (readSetting(tx, SETTING_SETUP_COMPLETE) !== true) {
          writeSetting(tx, SETTING_SETUP_TOKEN_HASH, tokenHash);
        }
      });
    },

    async resetAuth({ tokenHash }) {
      db.transaction((tx) => {
        tx.delete(authCredential).run();
        tx.delete(authRecovery).run();
        tx.delete(session).run();
        tx.delete(authChallenge).run();
        deleteSetting(tx, SETTING_SETUP_COMPLETE);
        deleteSetting(tx, SETTING_USER_ID);
        writeSetting(tx, SETTING_SETUP_TOKEN_HASH, tokenHash);
      });
    },

    async listCredentials() {
      return db.select().from(authCredential).orderBy(authCredential.createdAt).all();
    },

    async getCredentialByCredentialId(credentialId) {
      return db
        .select()
        .from(authCredential)
        .where(eq(authCredential.credentialId, credentialId))
        .get();
    },

    async getCredentialById(id) {
      return db.select().from(authCredential).where(eq(authCredential.id, id)).get();
    },

    async insertCredential(credential: CredentialRow) {
      db.insert(authCredential).values(credential).run();
    },

    async renameCredential(id, nickname) {
      const result = db
        .update(authCredential)
        .set({ nickname })
        .where(eq(authCredential.id, id))
        .run();
      return result.changes > 0;
    },

    async deleteCredentialUnlessLast(id): Promise<DeleteCredentialResult> {
      return db.transaction((tx) => {
        const deleted = tx
          .delete(authCredential)
          .where(and(eq(authCredential.id, id), sql`(select count(*) from ${authCredential}) > 1`))
          .returning({ id: authCredential.id })
          .all();
        if (deleted.length > 0) {
          return 'deleted';
        }
        const exists = tx.select().from(authCredential).where(eq(authCredential.id, id)).get();
        return exists === undefined ? 'not_found' : 'last_credential';
      });
    },

    async updateSignCount(id, signCount, lastUsedAt) {
      db.update(authCredential)
        .set({ signCount, lastUsedAt })
        .where(eq(authCredential.id, id))
        .run();
    },

    async insertChallenge(challenge) {
      db.insert(authChallenge).values(challenge).run();
    },

    async consumeChallenge(id) {
      return db.delete(authChallenge).where(eq(authChallenge.id, id)).returning().get();
    },

    async pruneChallenges(now) {
      db.delete(authChallenge).where(lte(authChallenge.expiresAt, now)).run();
    },

    async listUnusedRecovery() {
      return db
        .select({ id: authRecovery.id, codeHash: authRecovery.codeHash })
        .from(authRecovery)
        .where(isNull(authRecovery.usedAt))
        .all();
    },

    async consumeRecovery(id, now) {
      const result = db
        .update(authRecovery)
        .set({ usedAt: now })
        .where(and(eq(authRecovery.id, id), isNull(authRecovery.usedAt)))
        .run();
      return result.changes > 0;
    },

    async insertSession(row) {
      db.insert(session).values(row).run();
    },

    async getSessionByTokenHash(tokenHash) {
      return db.select().from(session).where(eq(session.tokenHash, tokenHash)).get();
    },

    async touchSession(id, now) {
      db.update(session).set({ lastSeenAt: now }).where(eq(session.id, id)).run();
    },

    async deleteSession(id) {
      db.delete(session).where(eq(session.id, id)).run();
    },

    async deleteAllSessions() {
      db.delete(session).run();
    },

    async deleteExpiredSessions(now, idleMs) {
      db.delete(session)
        .where(or(lte(session.expiresAt, now), lte(sql`${session.lastSeenAt} + ${idleMs}`, now)))
        .run();
    },
  };
}
