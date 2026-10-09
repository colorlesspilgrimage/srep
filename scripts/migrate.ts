import pino from 'pino';
import { getConfig } from '../src/lib/server/config.ts';
import { createDb } from '../src/lib/server/db/client.ts';
import { runMigrations } from '../src/lib/server/db/migrate.ts';
import { createLogger } from '../src/lib/server/logger.ts';

function fatal(error: unknown): void {
  const logger = createLogger({
    level: 'info',
    destination: pino.destination({ sync: true }),
  });
  logger.fatal({ err: error }, 'migration failed');
}

async function main(): Promise<void> {
  let config;
  try {
    config = getConfig();
  } catch (error: unknown) {
    fatal(error);
    process.exit(1);
  }

  const logger = createLogger({
    level: config.logLevel,
    destination: pino.destination({ sync: true }),
  });
  const db = createDb(config);
  try {
    await runMigrations(db, config, logger);
    await db.close();
  } catch (error: unknown) {
    logger.error({ err: error }, 'migration failed');
    await db.close().catch(() => undefined);
    process.exit(1);
  }
}

await main();
