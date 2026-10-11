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

## Decks, notes and media (M2)

Decks, note types, notes, generated cards and content-addressed media, through a JSON API and a demo script.

- Entry point: API under `/api/decks`, `/api/presets`, `/api/note-types`, `/api/notes`, `/api/cards/move`, `/api/media`. Script `npm run domain:demo`.
- Use:
  1. Start the server and log in (see "Authentication (M1)"). Every route needs a session cookie. Mutating calls need the `origin` header, the `x-srep-csrf` header and `content-type: application/json`.
  2. Create a deck: `POST /api/decks` with `{"name":"Languages"}`. Create a child with `{"name":"Japanese","parentId":"<id>"}`.
  3. List built-in note types: `GET /api/note-types` (Basic, Basic+Reversed, Cloze).
  4. Create a note: `POST /api/notes` with `{"noteTypeId":"<id>","deckId":"<id>","fields":["犬","dog"],"tags":["animals"]}`. The reply lists the generated cards with rendered front and back text.
  5. Rename or move a deck: `PATCH /api/decks/<id>` with `{"name":"Lang"}` or `{"parentId":null}`.
  6. Delete a deck: `GET /api/decks/<id>/impact`, then `DELETE /api/decks/<id>` with `{"action":"move","targetDeckId":"<id>"}` or `{"action":"trash"}`.
  7. Upload media: `POST /api/media` with the file bytes and the matching `content-type`. Use the returned `sha256` as `{{media:<sha256>}}` in a field.
  8. No server needed: run `SREP_DATABASE_URL=sqlite:/tmp/demo.db SREP_MEDIA_DIR=/tmp/demo-media npm run domain:demo -- --unique`.
- Check:
  - `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/notes/00000000-0000-4000-8000-000000000001` prints `401`.
  - `npx vitest run src/lib/server/domain src/routes/api scripts` passes.
  - The demo prints JSON lines with card counts 1, 2 and 2, and the renamed paths `Lang-<n>` and `Lang-<n>::Japanese`.
  - `npm run test:e2e` passes (`e2e/domain.test.ts`).
  - Postgres: set `SREP_TEST_POSTGRES_URL` and run `npx vitest run src/lib/server/db/db.pg.test.ts` (the domain store suite runs there).
- Code and tests:
  - Code: `src/lib/server/domain/` (`core/` pure logic, `store/` repository, services), `src/routes/api/{decks,presets,note-types,notes,cards,media}/`, `src/lib/server/db/schema/{sqlite,pg}.ts`, `drizzle/sqlite/0002_big_expediter.sql`, `drizzle/pg/0002_optimal_sally_floyd.sql`, `scripts/domain-demo.ts`.
  - Tests: `src/lib/server/domain/**/*.test.ts`, `src/routes/api/{decks,presets,note-types,notes,cards,media}/server.test.ts`, `src/lib/server/auth/hook.test.ts` (401 for every new route), `scripts/domain-demo.test.ts`, `e2e/domain.test.ts`.

## Health endpoint (M0)

`GET /healthz` returns `{"status":"ok"}` when the database answers. It needs no session.

- Entry point: `GET /healthz`.
- Use: 1. Start the server. 2. Run `curl http://localhost:3000/healthz`.
- Check: the output is `{"status":"ok"}`. `npx vitest run src/routes/healthz` passes.
- Code and tests: `src/routes/healthz/+server.ts`, `src/lib/server/health.ts`, `src/routes/healthz/server.test.ts`, `e2e/health.test.ts`.
