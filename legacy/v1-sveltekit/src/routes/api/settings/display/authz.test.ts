import { defineSettingsAuthzSuite } from '#lib/server/auth/test-support/settings-authz.suite.js';

defineSettingsAuthzSuite(
  'display route authorization',
  '/api/settings/display',
  '/%61pi/settings/display',
);
