import { and, eq, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  SETTING_SETUP_COMPLETE,
  SETTING_SETUP_TOKEN_HASH,
  SETTING_USER_ID,
  type AuthStore,
  type DeleteCredentialResult,
} from '#lib/server/auth/store-types.js';
import {
  appSettings,
  authChallenge,
  authCredential,
  authRecovery,
  session,
} from '#lib/server/db/schema/pg.js';
import type { JsonValue } from '#lib/server/db/schema/sqlite.js';

type Exec = Pick<PostgresJsDatabase, 'select' | 'insert' | 'delete' | 'update'>;

async function readSetting(db: Exec, key: string): Promise<JsonValue | undefined> {
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, key));
  return rows[0]?.value;
}

async function writeSetting(db: Exec, key: string, value: JsonValue): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } });
}

async function deleteSetting(db: Exec, key: string): Promise<void> {
  await db.delete(appSettings).where(eq(appSettings.key, key));
}

export function createPgStore(db: PostgresJsDatabase): AuthStore {
  return {
    async isSetupComplete() {
      return (await readSetting(db, SETTING_SETUP_COMPLETE)) === true;
    },

    async getSetupTokenHash() {
      const value = await readSetting(db, SETTING_SETUP_TOKEN_HASH);
      return typeof value === 'string' ? value : null;
    },

    async getOrCreateUserId(candidate) {
      await db
        .insert(appSettings)
        .values({ key: SETTING_USER_ID, value: candidate })
        .onConflictDoNothing();
      return String(await readSetting(db, SETTING_USER_ID));
    },

    async completeSetup({ credential, recoveryHashes, session: newSession }) {
      return db.transaction(async (tx) => {
        // The insert is the lock. A parallel setup waits here, then finds the row.
        const lock = await tx
          .insert(appSettings)
          .values({ key: SETTING_SETUP_COMPLETE, value: true })
          .onConflictDoNothing()
          .returning({ key: appSettings.key });
        if (lock.length === 0) {
          return { ok: false as const, reason: 'locked' as const };
        }
        await tx.insert(authCredential).values(credential);
        await tx
          .insert(authRecovery)
          .values(recoveryHashes.map((r) => ({ id: r.id, codeHash: r.codeHash })));
        await deleteSetting(tx, SETTING_SETUP_TOKEN_HASH);
        await tx.insert(session).values(newSession);
        return { ok: true as const };
      });
    },

    async armSetup(tokenHash) {
      await db.transaction(async (tx) => {
        if ((await readSetting(tx, SETTING_SETUP_COMPLETE)) !== true) {
          await writeSetting(tx, SETTING_SETUP_TOKEN_HASH, tokenHash);
        }
      });
    },

    async resetAuth({ tokenHash }) {
      await db.transaction(async (tx) => {
        await tx.delete(authCredential);
        await tx.delete(authRecovery);
        await tx.delete(session);
        await tx.delete(authChallenge);
        await deleteSetting(tx, SETTING_SETUP_COMPLETE);
        await deleteSetting(tx, SETTING_USER_ID);
        await writeSetting(tx, SETTING_SETUP_TOKEN_HASH, tokenHash);
      });
    },

    async listCredentials() {
      return db.select().from(authCredential).orderBy(authCredential.createdAt);
    },

    async getCredentialByCredentialId(credentialId) {
      const rows = await db
        .select()
        .from(authCredential)
        .where(eq(authCredential.credentialId, credentialId));
      return rows[0];
    },

    async getCredentialById(id) {
      const rows = await db.select().from(authCredential).where(eq(authCredential.id, id));
      return rows[0];
    },

    async insertCredential(credential) {
      await db.insert(authCredential).values(credential);
    },

    async renameCredential(id, nickname) {
      const rows = await db
        .update(authCredential)
        .set({ nickname })
        .where(eq(authCredential.id, id))
        .returning({ id: authCredential.id });
      return rows.length > 0;
    },

    async deleteCredentialUnlessLast(id): Promise<DeleteCredentialResult> {
      return db.transaction(async (tx) => {
        // Lock every credential row, so parallel revokes run one after the other.
        const all = await tx.select({ id: authCredential.id }).from(authCredential).for('update');
        if (!all.some((row) => row.id === id)) {
          return 'not_found';
        }
        if (all.length <= 1) {
          return 'last_credential';
        }
        await tx.delete(authCredential).where(eq(authCredential.id, id));
        return 'deleted';
      });
    },

    async updateSignCount(id, signCount, lastUsedAt) {
      const advances =
        signCount === 0 ? eq(authCredential.signCount, 0) : lt(authCredential.signCount, signCount);
      const updated = await db
        .update(authCredential)
        .set({ signCount, lastUsedAt })
        .where(and(eq(authCredential.id, id), advances))
        .returning({ id: authCredential.id });
      return updated.length > 0;
    },

    async insertChallenge(challenge) {
      await db.insert(authChallenge).values(challenge);
    },

    async consumeChallenge(id) {
      const rows = await db.delete(authChallenge).where(eq(authChallenge.id, id)).returning();
      return rows[0];
    },

    async pruneChallenges(now) {
      await db.delete(authChallenge).where(lte(authChallenge.expiresAt, now));
    },

    async listUnusedRecovery() {
      return db
        .select({ id: authRecovery.id, codeHash: authRecovery.codeHash })
        .from(authRecovery)
        .where(isNull(authRecovery.usedAt));
    },

    async consumeRecovery(id, now) {
      const rows = await db
        .update(authRecovery)
        .set({ usedAt: now })
        .where(and(eq(authRecovery.id, id), isNull(authRecovery.usedAt)))
        .returning({ id: authRecovery.id });
      return rows.length > 0;
    },

    async insertSession(row) {
      await db.insert(session).values(row);
    },

    async getSessionByTokenHash(tokenHash) {
      const rows = await db.select().from(session).where(eq(session.tokenHash, tokenHash));
      return rows[0];
    },

    async touchSession(id, now) {
      await db.update(session).set({ lastSeenAt: now }).where(eq(session.id, id));
    },

    async deleteSession(id) {
      await db.delete(session).where(eq(session.id, id));
    },

    async deleteAllSessions() {
      await db.delete(session);
    },

    async deleteExpiredSessions(now, idleMs) {
      await db
        .delete(session)
        .where(or(lte(session.expiresAt, now), lte(sql`${session.lastSeenAt} + ${idleMs}`, now)));
    },
  };
}
