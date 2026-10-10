# Feature map

Each entry lists the entry point, how to use the feature, how to check it, and the code.

## Authentication (M1)

Single-user passwordless login with WebAuthn passkeys and security keys, recovery codes, and cookie sessions.

- Entry point: browser path `/setup` (first run), `/login`, `/security`. API under `/api/auth/*`. CLI `srep reset-auth`.
- Use:
  1. Start the server: `npm run build && node build`. Read the line `srep setup is not complete ... setup token: <token>` in the log.
  2. Open `<SREP_ORIGIN>/setup`. Enter the token and a nickname. Press "Create". Save the 10 recovery codes.
  3. Open `/security` to add a second credential, rename or revoke credentials, or log out.
  4. Open `/login` and use "Log in with a passkey" or "Log in with a security key".
  5. If all credentials are lost, log in with a recovery code on `/login`, or run `npm run srep -- reset-auth` (Docker: `docker compose exec srep srep reset-auth`) and open `/setup` with the new token.
  6. Set `SREP_ORIGIN`, `SREP_RP_ID` and `SREP_RP_NAME` for a real domain. HTTPS is required except on `localhost`.
- Check:
  - `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/decks` prints `401`.
  - `curl -s http://localhost:3000/api/auth/status` prints `{"setupComplete":false,"authenticated":false}` on a fresh instance.
  - `npx vitest run src/lib/server/auth src/routes/api scripts` passes.
  - `npm run test:e2e` passes (`e2e/auth.test.ts`).
- Code and tests:
  - Code: `src/lib/server/auth/`, `src/routes/api/auth/`, `src/routes/{setup,login,security}/`, `src/lib/client/`, `src/hooks.server.ts`, `scripts/srep.ts`, `src/lib/server/db/schema/{sqlite,pg}.ts`, `drizzle/*/0001_*`.
  - Tests: `src/lib/server/auth/*.test.ts`, `src/routes/api/auth/**/server.test.ts`, `scripts/srep.test.ts`, `e2e/auth.test.ts`.

## Health endpoint (M0)

`GET /healthz` returns `{"status":"ok"}` when the database answers. It needs no session.

- Entry point: `GET /healthz`.
- Use: 1. Start the server. 2. Run `curl http://localhost:3000/healthz`.
- Check: the output is `{"status":"ok"}`. `npx vitest run src/routes/healthz` passes.
- Code and tests: `src/routes/healthz/+server.ts`, `src/lib/server/health.ts`, `src/routes/healthz/server.test.ts`, `e2e/health.test.ts`.
