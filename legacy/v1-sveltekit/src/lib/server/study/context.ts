import crypto from 'node:crypto';
import { getDb } from '#lib/server/db/index.js';
import { getDomainContext } from '#lib/server/domain/context.js';
import { getLogger } from '#lib/server/logger.js';
import { once } from '#lib/server/once.js';
import type { StudyDeps } from '#lib/server/study/deps.js';
import { getStudyStore } from '#lib/server/study/store/store.js';

export const getStudyContext = once((): StudyDeps => ({
  store: getStudyStore(getDb()),
  domain: getDomainContext().store,
  now: Date.now,
  random: crypto.randomBytes,
  logger: getLogger(),
}));
