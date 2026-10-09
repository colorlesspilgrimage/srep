import pino, { type DestinationStream, type Logger } from 'pino';
import { getConfig } from '#lib/server/config.js';

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
    ],
  };
  if (opts.destination === undefined) {
    return pino(options);
  }
  return pino(options, opts.destination);
}

let cached: Logger | undefined;

export function getLogger(): Logger {
  if (cached === undefined) {
    cached = createLogger({ level: getConfig().logLevel });
  }
  return cached;
}
