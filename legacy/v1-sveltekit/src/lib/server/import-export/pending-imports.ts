import crypto from 'node:crypto';
import type { PendingImport } from '#lib/server/import-export/types.js';

const TTL_MS = 15 * 60 * 1000;
const pending = new Map<string, PendingImport>();

function prune(now: number): void {
  for (const [token, entry] of pending) {
    if (entry.expiresAt <= now) {
      pending.delete(token);
    }
  }
}

export function stashPending(entry: Omit<PendingImport, 'expiresAt'>, now: number): string {
  prune(now);
  const token = crypto.randomBytes(24).toString('hex');
  pending.set(token, { ...entry, expiresAt: now + TTL_MS });
  return token;
}

export function takePending(token: string, now: number): PendingImport | undefined {
  prune(now);
  const entry = pending.get(token);
  if (entry === undefined || entry.expiresAt <= now) {
    pending.delete(token);
    return undefined;
  }
  pending.delete(token);
  return entry;
}

export function clearPendingImports(): void {
  pending.clear();
}
