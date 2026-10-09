import { defineConfig, devices } from '@playwright/test';

const webEnv = { ...process.env };
delete webEnv.NODE_ENV;

export default defineConfig({
  testDir: 'e2e',
  use: {
    baseURL: 'http://127.0.0.1:4173',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run build && node build',
    url: 'http://127.0.0.1:4173/healthz',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...webEnv,
      NODE_ENV: 'production',
      PORT: '4173',
      HOST: '127.0.0.1',
      ORIGIN: 'http://127.0.0.1:4173',
      SREP_DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'sqlite:./data/e2e.db',
      SREP_LOG_LEVEL: 'warn',
    },
  },
});
