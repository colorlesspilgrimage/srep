import type { RandomBytes } from '#lib/server/auth/tokens.js';
import type { DomainStore } from '#lib/server/domain/store/store-types.js';
import type { StudyStore } from '#lib/server/study/store/study-store-types.js';

export type StudyLogger = { error: (obj: object, msg?: string) => void };

/** The study services get every I/O port from here. Tests pass a fake clock and random. */
export type StudyDeps = {
  store: StudyStore;
  domain: DomainStore;
  now: () => number;
  random: RandomBytes;
  logger: StudyLogger;
};
