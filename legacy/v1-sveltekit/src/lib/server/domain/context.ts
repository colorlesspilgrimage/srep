import crypto from 'node:crypto';
import { getConfig } from '#lib/server/config.js';
import { getDb } from '#lib/server/db/index.js';
import type { DomainDeps } from '#lib/server/domain/deps.js';
import { createFsMediaFiles } from '#lib/server/domain/media-files.fs.js';
import { getDomainStore } from '#lib/server/domain/store/store.js';
import { once } from '#lib/server/once.js';

export const getDomainContext = once((): DomainDeps => ({
  store: getDomainStore(getDb()),
  media: createFsMediaFiles(getConfig().media.dir),
  now: Date.now,
  random: crypto.randomBytes,
  limits: { mediaMaxBytes: getConfig().media.maxBytes },
}));
