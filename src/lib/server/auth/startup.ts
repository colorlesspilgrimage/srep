import type { AuthDeps } from '#lib/server/auth/deps.js';
import { purgeExpired } from '#lib/server/auth/sessions.js';
import { ensureSetupToken } from '#lib/server/auth/setup.js';

const MAINTENANCE_INTERVAL_MS = 10 * 60 * 1000;

// Prints the setup token once, when setup is open. This is the only place that logs it.
export async function announceSetupToken(deps: AuthDeps): Promise<void> {
  const token = await ensureSetupToken(deps);
  if (token !== null) {
    deps.logger.warn(
      {},
      `srep setup is not complete. Open ${deps.auth.origin}/setup and use this setup token: ${token}`,
    );
  }
}

async function maintain(deps: AuthDeps): Promise<void> {
  try {
    await purgeExpired(deps);
    await deps.store.pruneChallenges(deps.now());
  } catch (error: unknown) {
    deps.logger.warn({ err: error }, 'auth cleanup failed');
  }
}

// Runs the cleanup now and then every 10 minutes. Returns a function that stops it.
export async function startMaintenance(deps: AuthDeps): Promise<() => void> {
  await maintain(deps);
  const timer = setInterval(() => void maintain(deps), MAINTENANCE_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
