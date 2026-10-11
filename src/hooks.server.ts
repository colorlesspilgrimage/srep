import { sequence, type Handle, type ServerInit } from '@sveltejs/kit/hooks';
import { getAuthContext } from '#lib/server/auth/context.js';
import { handleAuth } from '#lib/server/auth/hook.js';
import { announceSetupToken, startMaintenance } from '#lib/server/auth/startup.js';
import { getConfig } from '#lib/server/config.js';
import { getDb } from '#lib/server/db/index.js';
import { runMigrations } from '#lib/server/db/migrate.js';
import { getDomainContext } from '#lib/server/domain/context.js';
import { seedDomain } from '#lib/server/domain/seed.js';
import { createSyncLogger, getLogger } from '#lib/server/logger.js';

const shutdownFlag = '__srepShutdownRegistered';

function registerShutdown(stopMaintenance: () => void): void {
  const globalState = globalThis as typeof globalThis & { [shutdownFlag]?: boolean };
  if (globalState[shutdownFlag] === true) {
    return;
  }
  globalState[shutdownFlag] = true;

  const onSignal = (signal: NodeJS.Signals): void => {
    const logger = getLogger();
    logger.info({ signal }, 'shutdown');
    stopMaintenance();
    void getDb()
      .close()
      .finally(() => {
        process.exit(0);
      });
  };

  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
}

function logFatal(error: unknown): void {
  createSyncLogger('info').fatal({ err: error }, 'startup failed');
}

export const init: ServerInit = async () => {
  try {
    const config = getConfig();
    const logger = getLogger();
    const db = getDb();
    if (config.database.dialect === 'sqlite') {
      logger.info({ dialect: 'sqlite' }, 'database ready');
    } else {
      const parsed = new URL(config.database.url);
      const database = parsed.pathname.replace(/^\//, '');
      logger.info({ dialect: 'postgres', host: parsed.hostname, database }, 'database ready');
    }
    if (config.migrateOnStart) {
      await runMigrations(db, config, logger);
    }
    // Adds the built-in preset and note types, and empties trash older than 30 days.
    await seedDomain(getDomainContext());
    const { deps } = getAuthContext();
    await announceSetupToken(deps);
    registerShutdown(await startMaintenance(deps));
  } catch (error: unknown) {
    logFatal(error);
    throw error;
  }
};

const logRequests: Handle = async ({ event, resolve }) => {
  const started = Date.now();
  const response = await resolve(event);
  const durationMs = Date.now() - started;
  const path = event.url.pathname;
  const fields = {
    method: event.request.method,
    path,
    status: response.status,
    durationMs,
  };
  const logger = getLogger();
  if (path === '/healthz') {
    logger.debug(fields);
  } else {
    logger.info(fields);
  }
  return response;
};

const authenticate: Handle = ({ event, resolve }) =>
  handleAuth(getAuthContext().deps, event, resolve);

export const handle: Handle = sequence(logRequests, authenticate);
