import { defineSettingsAuthzSuite } from '#lib/server/auth/test-support/settings-authz.suite.js';

defineSettingsAuthzSuite(
  'theme route authorization',
  '/api/settings/theme',
  '/%61pi/settings/theme',
);
