import type { RandomBytes } from '#lib/server/auth/tokens.js';
import type { MediaFiles } from '#lib/server/domain/media-files.js';
import type { DomainStore } from '#lib/server/domain/store/store-types.js';

export type DomainDeps = {
  store: DomainStore;
  media: MediaFiles;
  now: () => number;
  random: RandomBytes;
  limits: { mediaMaxBytes: number };
};
