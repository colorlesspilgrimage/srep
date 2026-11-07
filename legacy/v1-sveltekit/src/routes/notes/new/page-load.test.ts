import { vi } from 'vitest';
import {
  asSignedInPageLoad,
  defineSignedInPageLoadSuite,
} from '#lib/server/http/signed-in-page-load.suite.js';

const { readGallerySettings } = vi.hoisted(() => ({
  readGallerySettings: vi.fn(),
}));

vi.mock('#lib/server/settings/gallery-settings-read.js', () => ({
  readGallerySettings,
}));

vi.mock('#lib/server/db/index.js', () => ({
  getDb: () => ({ dialect: 'sqlite', db: {} }),
}));

import { load } from './+page.server.js';

defineSignedInPageLoadSuite('new note page load', asSignedInPageLoad(load), readGallerySettings);
