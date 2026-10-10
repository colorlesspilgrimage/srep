import { fail, type AuthDeps, type Result } from '#lib/server/auth/deps.js';
import { normalizeRecoveryCode, verifyRecoveryCode } from '#lib/server/auth/recovery-codes.js';
import { createSession } from '#lib/server/auth/sessions.js';

export async function recoveryLogin(
  deps: AuthDeps,
  input: { code: string; userAgent: string },
): Promise<Result<{ sessionToken: string; maxAgeSec: number; remaining: number }>> {
  const failed = fail(401, 'recovery_failed');
  const code = normalizeRecoveryCode(input.code);
  if (code === null) {
    return failed;
  }
  const unused = await deps.store.listUnusedRecovery();
  // Check every row. Do not stop at the first match.
  let matchId: string | null = null;
  for (const row of unused) {
    if (verifyRecoveryCode(code, row.codeHash)) {
      matchId = row.id;
    }
  }
  if (matchId === null || !(await deps.store.consumeRecovery(matchId, deps.now()))) {
    return failed;
  }
  const session = await createSession(deps, input.userAgent);
  deps.logger.warn({}, 'recovery code used');
  return {
    ok: true,
    sessionToken: session.rawToken,
    maxAgeSec: session.maxAgeSec,
    remaining: unused.length - 1,
  };
}
