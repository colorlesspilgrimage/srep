import { randomInt } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';

const webEnv = { ...process.env };
delete webEnv.NODE_ENV;

const runAddress = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
const rustE2e = process.env.SREP_E2E_RUST === '1';

const rustPort = '4173';
const nodeEnv = {
  ...webEnv,
  NODE_ENV: 'production',
  PORT: rustPort,
  HOST: '127.0.0.1',
  ORIGIN: `http://localhost:${rustPort}`,
  ADDRESS_HEADER: 'x-forwarded-for',
  XFF_DEPTH: '1',
  SREP_ORIGIN: `http://localhost:${rustPort}`,
  SREP_DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'sqlite:./data/e2e.db',
  SREP_LOG_LEVEL: 'warn',
  SREP_MEDIA_DIR: './data/e2e-media',
  SREP_E2E_CLOCK: '1',
  BODY_SIZE_LIMIT: '11M',
  SREP_RP_ID: 'localhost',
};

export default defineConfig({
  testDir: 'e2e',
  // v2 Leptos UI is not yet at v1 parity; CI runs the Rust smoke suite only.
  testMatch:
    rustE2e && process.env.CI ? /health\.test\.ts/ : undefined,
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: `http://localhost:${rustPort}`,
    extraHTTPHeaders: { 'x-forwarded-for': runAddress },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: rustE2e
    ? {
        command: process.env.CI
          ? 'rm -rf ./data/e2e.db ./data/e2e-media && mkdir -p ./data && ./target/release/srep-server'
          : 'rm -rf ./data/e2e.db ./data/e2e-media && mkdir -p ./data && PROFILE=release ./scripts/build-wasm.sh && cargo build -p srep-server && ./target/debug/srep-server',
        url: `http://localhost:${rustPort}/healthz`,
        reuseExistingServer: !process.env.CI,
        timeout: process.env.CI ? 120_000 : 300_000,
        env: nodeEnv,
      }
    : {
        command: 'npm run build && node build',
        url: `http://localhost:${rustPort}/healthz`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: nodeEnv,
      },
});
