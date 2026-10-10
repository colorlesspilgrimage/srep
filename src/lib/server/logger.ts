import pino, { type DestinationStream, type Logger } from 'pino';
import { getConfig } from '#lib/server/config.js';
import { once } from '#lib/server/once.js';

export function createLogger(opts: { level: string; destination?: DestinationStream }): Logger {
  const options = {
    level: opts.level,
    base: { service: 'srep' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: [
      'password',
      'token',
      '*.password',
      '*.token',
      'req.headers.authorization',
      'req.headers.cookie',
      'code',
      'setupToken',
      'recoveryCode',
      'sessionToken',
      '*.code',
      '*.setupToken',
      '*.recoveryCode',
      '*.sessionToken',
      'req.headers["x-srep-csrf"]',
      'res.headers["set-cookie"]',
    ],
  };
  if (opts.destination === undefined) {
    return pino(options);
  }
  return pino(options, opts.destination);
}

export function createSyncLogger(level: string): Logger {
  return createLogger({
    level,
    destination: pino.destination({ sync: true }),
  });
}

export const getLogger = once(() => createLogger({ level: getConfig().logLevel }));
