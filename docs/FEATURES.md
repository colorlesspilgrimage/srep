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

## Scheduler and study engine (M3)

FSRS scheduling with learning steps, a day-rollover clock, daily limits, a queue builder, answer, undo, suspend, bury, sibling burying, and a replay check of the review log.

- Entry point: API under `/api/study/{next,answer,undo,verify,rebuild}`, `/api/cards/{suspend,unsuspend,bury}`, `/api/settings/study`. Script `npm run study:simulate`.
- Use:
  1. Start the server and log in (see "Authentication (M1)"). Mutating calls need the `origin`, `x-srep-csrf` and `content-type: application/json` headers.
  2. Add decks and notes (see "Decks, notes and media (M2)").
  3. Set the study day (optional): `PUT /api/settings/study` with `{"rolloverHour":4,"timezone":"Europe/Berlin"}`. The default is hour 4 and `UTC`.
  4. Get the next card: `GET /api/study/next?deckId=<id>`. The reply has `status` (`card`, `wait` or `done`), the card with its four preview intervals, and the counts.
  5. Answer: `POST /api/study/answer` with `{"cardId":"<id>","rating":3,"reps":<reps from next>,"elapsedMs":4000}`. Ratings: 1 Again, 2 Hard, 3 Good, 4 Easy.
  6. Undo the last review: `POST /api/study/undo` with `{}`.
  7. Suspend, unsuspend or bury cards: `POST /api/cards/suspend` (also `unsuspend`, `bury`) with `{"cardIds":["<id>"]}`.
  8. Check the cache against the log: `GET /api/study/verify`. Repair it: `POST /api/study/rebuild` with `{}`. Editing a preset changes the replay result; run `rebuild` after such an edit.
  9. No server needed: `npm run study:simulate -- --days 365`. The script always uses an in-memory database. It ignores `SREP_DATABASE_URL`, so it never changes your data.
- Notes: ts-fsrs is pinned to `5.4.2`. Fuzz is off. Learning steps are rounded to whole minutes (at least 1), because ts-fsrs counts whole minutes only. A preset with 20 `fsrsParams` gets `422 bad_preset` (ts-fsrs accepts 19 or 21). Daily limits count the review log rows of the card's current deck, so a moved card takes its past reviews with it.
- Check:
  - `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4173/api/study/next` prints `401`.
  - `npm run study:simulate -- --days 365` prints a last line with `"limitViolations":0,"replayMismatches":0,"undoMismatches":0` and exits 0.
  - `npx vitest run src/lib/server/study src/routes/api scripts` passes.
  - `npm run test:e2e` passes (`e2e/study.test.ts`).
  - Postgres: set `SREP_TEST_POSTGRES_URL` and run `npx vitest run src/lib/server/db/db.pg.test.ts` (the study store suite runs there).
- Code and tests:
  - Code: `src/lib/server/study/` (`core/` pure logic, `store/` repository, services), `src/routes/api/{study,settings}/`, `src/routes/api/cards/{suspend,unsuspend,bury}/`, `src/lib/server/db/schema/{sqlite,pg}.ts`, `drizzle/sqlite/0003_equal_metal_master.sql`, `drizzle/pg/0003_steep_the_initiative.sql`, `scripts/study-simulate.ts`.
  - Tests: `src/lib/server/study/**/*.test.ts`, `src/lib/server/study/store/study-store.suite.ts`, `src/lib/server/study/store/study-store-race.suite.ts` (Postgres only), `src/routes/api/{study,settings}/**/server.test.ts`, `src/routes/api/cards/server.test.ts`, `src/lib/server/auth/hook.test.ts`, `scripts/study-simulate.test.ts`, `e2e/study.test.ts`.

## Health endpoint (M0)

`GET /healthz` returns `{"status":"ok"}` when the database answers. It needs no session.

- Entry point: `GET /healthz`.
- Use: 1. Start the server. 2. Run `curl http://localhost:3000/healthz`.
- Check: the output is `{"status":"ok"}`. `npx vitest run src/routes/healthz` passes.
- Code and tests: `src/routes/healthz/+server.ts`, `src/lib/server/health.ts`, `src/routes/healthz/server.test.ts`, `e2e/health.test.ts`.

## TUI gallery shell (M4 slice 1)

A signed-in gallery shows pane, border, list, form, modal, and status-line samples on a character grid. Desktop shows two panes. A 360px width shows one pane and a tab bar. The default theme is Phosphor Green. The Themes list can show every pre-made theme.

- Entry point: browser path `/gallery` after sign-in. Home page link `Gallery`.
- Use:
  1. Start the server and sign in (see "Authentication (M1)").
  2. Open `/gallery`.
  3. At a wide window, choose `Form` in the specimen list. Submit `cat`.
  4. Choose `Modal`. Press `Open modal`. Press Escape.
  5. Narrow the window to 360px. Use the `Gallery sections` tabs for the same steps.
- Check:
  - `curl -s -D - -o /dev/null http://127.0.0.1:3000/gallery` on a fresh database returns `303` and `location: /setup`.
  - `npx vitest run src/lib/client/tui src/lib/server/auth/hook.test.ts` passes.
  - `npx playwright test e2e/gallery.test.ts` passes.
- Code and tests:
  - Code: `src/lib/client/tui/`, `src/routes/gallery/+page.svelte`, link in `src/routes/+page.svelte`.
  - Tests: `src/lib/client/tui/*.test.ts`, `src/lib/server/auth/hook.test.ts`, `e2e/gallery.test.ts`.

## TUI themes and contrast (M4 slice 2)

The gallery can show 12 pre-made themes. The choice is not saved. Each theme passes WCAG 2.2 AA contrast. High Contrast text also passes 7:1.

- Entry point: browser path `/gallery` after sign-in. Optional query `theme` with a catalog id, for example `/gallery?theme=nord`.
- Use:
  1. Start the server and sign in (see "Authentication (M1)").
  2. Open `/gallery`.
  3. In the `Themes` list, choose `Nord`.
  4. Open `/gallery?theme=solarized-light`.
  5. Reload `/gallery` with no query. The theme is Phosphor Green again.
- Check:
  - `curl -s -D - -o /dev/null 'http://127.0.0.1:3000/gallery?theme=nord'` on a fresh database returns `303` and `location: /setup`.
  - `npx vitest run src/lib/client/tui src/routes/gallery` passes.
  - `npx playwright test e2e/gallery.test.ts e2e/gallery-themes.test.ts` passes.
- Code and tests:
  - Code: `src/lib/client/tui/themes.ts`, `src/lib/client/tui/themes.css`, `src/lib/client/tui/GalleryShell.svelte`, `src/routes/gallery/+page.server.ts`, `src/routes/gallery/+page.svelte`.
  - Tests: `src/lib/client/tui/themes.test.ts`, `e2e/gallery-themes.test.ts`.

## TUI theme settings (M4 slice 3)

A signed-in user can preview a theme in the gallery Settings pane and save it. The next visit paints that theme in the first HTML.

- Entry point: browser path `/gallery` after sign-in. Tab or list item `Settings`. API `GET` and `PUT /api/settings/theme`.
- Use:
  1. Start the server and sign in (see "Authentication (M1)").
  2. Open `/gallery`.
  3. Open `Settings`. Choose `Nord`. The colors change before you save.
  4. Press `Save theme`.
  5. Reload `/gallery`. The theme is still Nord.
- Check:
  - `curl -s -o /dev/null -w '%{http_code}\n' -X PUT http://127.0.0.1:3000/api/settings/theme -H 'content-type: application/json' -d '{"id":"nord"}'` prints `401`.
  - `npx vitest run src/lib/client/tui src/lib/server/settings src/routes/gallery src/routes/api/settings/theme` passes.
  - `npm run test:e2e` passes.
- Code and tests:
  - Code: `src/lib/server/settings/theme-key.ts`, `src/lib/server/settings/theme-store.ts`, `src/lib/server/settings/theme-store.sqlite.ts`, `src/lib/server/settings/theme-store.pg.ts`, `src/lib/server/settings/theme-settings.ts`, `src/routes/api/settings/theme/+server.ts`, `src/lib/client/tui/SettingsPane.svelte`, `src/lib/client/tui/GalleryShell.svelte`, `src/routes/gallery/+page.server.ts`.
  - Tests: `src/lib/server/settings/theme-settings.test.ts`, `src/lib/server/settings/theme-store.race.test.ts`, `src/routes/api/settings/theme/server.test.ts`, `src/routes/gallery/cache-headers.test.ts`, `e2e/gallery-settings.test.ts`.
