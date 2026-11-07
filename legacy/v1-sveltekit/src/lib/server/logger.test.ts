import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from '#lib/server/logger.js';

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { lines, stream };
}

describe('createLogger', () => {
  it('writes one JSON line', () => {
    const { lines, stream } = capture();
    const logger = createLogger({ level: 'info', destination: stream });
    logger.info('hello');
    expect(lines).toHaveLength(1);
    const row = JSON.parse(lines[0] ?? '{}') as {
      level: number;
      time: string;
      service: string;
      msg: string;
    };
    expect(row.level).toBe(30);
    expect(Number.isNaN(Date.parse(row.time))).toBe(false);
    expect(row.service).toBe('srep');
    expect(row.msg).toBe('hello');
  });

  it('drops info lines at warn and writes nothing when silent', () => {
    const warnCapture = capture();
    const warnLogger = createLogger({ level: 'warn', destination: warnCapture.stream });
    warnLogger.info('hidden');
    warnLogger.warn('shown');
    expect(warnCapture.lines).toHaveLength(1);

    const silentCapture = capture();
    const silentLogger = createLogger({ level: 'silent', destination: silentCapture.stream });
    silentLogger.error('hidden');
    expect(silentCapture.lines).toHaveLength(0);
  });

  it('redacts a nested password', () => {
    const { lines, stream } = capture();
    const logger = createLogger({ level: 'info', destination: stream });
    logger.info({ user: { password: 'secret' } }, 'login');
    expect(lines[0]).not.toContain('secret');
    expect(lines[0]).toContain('Redacted');
  });

  it('redacts a top-level password and token', () => {
    const { lines, stream } = capture();
    const logger = createLogger({ level: 'info', destination: stream });
    logger.info({ password: 'secret-pass', token: 'secret-token' }, 'login');
    expect(lines[0]).not.toContain('secret-pass');
    expect(lines[0]).not.toContain('secret-token');
    expect(lines[0]).toContain('Redacted');
  });

  it('escapes a newline in the message', () => {
    const { lines, stream } = capture();
    const logger = createLogger({ level: 'info', destination: stream });
    logger.info('hello\nworld');
    const text = lines.join('');
    expect(text.trim().split('\n')).toHaveLength(1);
    expect(text).toContain('\\n');
  });
  it('redacts auth secrets at the top level and one level deep', () => {
    const { lines, stream } = capture();
    const logger = createLogger({ level: 'info', destination: stream });
    logger.info(
      {
        setupToken: 'st-1',
        code: 'cd-2',
        recoveryCode: 'rc-3',
        sessionToken: 'se-4',
        a: { code: 'cd-5', setupToken: 'st-6', recoveryCode: 'rc-7', sessionToken: 'se-8' },
        req: { headers: { 'x-srep-csrf': 'cs-9' } },
        res: { headers: { 'set-cookie': 'ck-10' } },
      },
      'secrets',
    );
    const text = lines.join('');
    for (const secret of [
      'st-1',
      'cd-2',
      'rc-3',
      'se-4',
      'cd-5',
      'st-6',
      'rc-7',
      'se-8',
      'cs-9',
      'ck-10',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain('[Redacted]');
  });
});
