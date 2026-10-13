# Contributing

## Setup

Install Node.js 22.17 or later.
Run `npm ci`.
Copy `.env.example` to `.env` if you need local overrides.

## Branches and commits

Create a branch from `main`.
Use Conventional Commits for commit messages.
One example is `feat: add health endpoint`.
Another example is `fix: close the database on shutdown`.

## Checks

Run these commands before you open a pull request:

```bash
npm run lint
npm run check
npm run test
npm run test:e2e
```

Unit tests use SQLite.
Set `SREP_TEST_POSTGRES_URL` to run Postgres unit tests.
Set `E2E_DATABASE_URL` to run end-to-end tests on Postgres.
Install Chromium for Playwright with `npx playwright install chromium`.
`npm run build` also builds the CLI in `build-cli/`.
The end-to-end tests run `npx tsx scripts/srep.ts reset-auth --yes` to reset the auth state.
The passkey tests use the Chromium virtual authenticator.

## Migrations

Edit `src/lib/server/db/schema/sqlite.ts`.
Edit `src/lib/server/db/schema/pg.ts`.
Keep the two files in sync.
Run `npm run db:generate`.
Commit the new files under `drizzle/sqlite` and `drizzle/pg`.
Every schema change needs both dialects.

## Documents

Write documents, reports, and code comments in ASD-STE100.
Use short sentences.
Use 20 words or fewer.
Use the active voice.
Do not use idioms or slang.
