import { defineSettingsAuthzSuite } from '#lib/server/auth/test-support/settings-authz.suite.js';

defineSettingsAuthzSuite(
  'keybind route authorization',
  '/api/settings/keybinds',
  '/%61pi/settings/keybinds',
);
