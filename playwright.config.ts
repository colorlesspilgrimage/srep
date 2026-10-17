import { randomInt } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';

const webEnv = { ...process.env };
delete webEnv.NODE_ENV;

// Every run gets its own client address, so the in-memory rate limit of a reused server
// does not carry over. The server reads the address from this header (see ADDRESS_HEADER).
const runAddress = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: 'http://localhost:4173',
    extraHTTPHeaders: { 'x-forwarded-for': runAddress },
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
      ADDRESS_HEADER: 'x-forwarded-for',
      XFF_DEPTH: '1',
      SREP_ORIGIN: 'http://localhost:4173',
      SREP_DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'sqlite:./data/e2e.db',
      SREP_LOG_LEVEL: 'warn',
      SREP_MEDIA_DIR: './data/e2e-media',
      // Lets e2e send x-srep-test-now. Production does not set this variable.
      SREP_E2E_CLOCK: '1',
      BODY_SIZE_LIMIT: '11M',
    },
  },
});
