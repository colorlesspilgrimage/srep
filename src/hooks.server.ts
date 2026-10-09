import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { getConfig } from '#lib/server/config.js';
import { getDb } from '#lib/server/db/index.js';
import { runMigrations } from '#lib/server/db/migrate.js';
import { createSyncLogger, getLogger } from '#lib/server/logger.js';

const shutdownFlag = '__srepShutdownRegistered';

function registerShutdown(): void {
  const globalState = globalThis as typeof globalThis & { [shutdownFlag]?: boolean };
  if (globalState[shutdownFlag] === true) {
    return;
  }
  globalState[shutdownFlag] = true;

  const onSignal = (signal: NodeJS.Signals): void => {
    const logger = getLogger();
    logger.info({ signal }, 'shutdown');
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
    registerShutdown();
  } catch (error: unknown) {
    logFatal(error);
    throw error;
  }
};

export const handle: Handle = async ({ event, resolve }) => {
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
