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

## TUI keyboard layer (M4 slice 4)

The gallery has a command palette, status-line key hints, and saved key remaps.

- Entry point: browser path `/gallery` after sign-in. Keys `Ctrl+K` and `:`. API `GET` and `PUT /api/settings/keybinds`.
- Use:
  1. Start the server and sign in (see "Authentication (M1)").
  2. Open `/gallery`.
  3. Press `Ctrl+K`. Choose `Show Settings`.
  4. Press `Change Open palette`, press `Alt+K`, then press `Save keys`.
  5. Reload `/gallery`. Press `Alt+K`. The palette opens.
- Check:
  - `curl -s -o /dev/null -w '%{http_code}\n' -X PUT http://127.0.0.1:3000/api/settings/keybinds -H 'content-type: application/json' -d '{"palette.open":"Ctrl+K","palette.open-colon":":","palette.close":"Escape"}'` prints `401`.
  - `npx vitest run src/lib/client/tui src/lib/server/settings src/routes/gallery src/routes/api/settings` passes.
  - `npm run test:e2e` passes.
- Code and tests:
  - Code: `src/lib/client/tui/keymap.ts`, `src/lib/client/tui/CommandPalette.svelte`, `src/lib/client/tui/KeymapForm.svelte`, `src/lib/server/settings/keybind-key.ts`, `src/lib/server/settings/keybind-store.ts`, `src/lib/server/settings/keybind-store.sqlite.ts`, `src/lib/server/settings/keybind-store.pg.ts`, `src/lib/server/settings/keybind-settings.ts`, `src/lib/server/settings/gallery-settings-read.ts`, `src/routes/api/settings/keybinds/+server.ts`, `src/routes/gallery/+page.server.ts`, `src/lib/client/tui/GalleryShell.svelte`.
  - Tests: `src/lib/client/tui/keymap.test.ts`, `src/lib/server/settings/keybind-settings.test.ts`, `src/lib/server/settings/keybind-store.race.test.ts`, `src/lib/server/settings/keybind-store.pg.test.ts`, `src/lib/server/settings/gallery-settings-read.test.ts`, `src/routes/api/settings/keybinds/server.test.ts`, `e2e/gallery-keys.test.ts`.

## TUI visual regression (M4 slice 5)

Playwright stores a gallery screenshot for every pre-made theme at 360px and at 1440px.

- Entry point: `npx playwright test e2e/gallery-visual.test.ts` after sign-in setup inside that file. The page is `/gallery?theme=<catalog id>`.
- Use:
  1. Run `npm ci`.
  2. Run `npx playwright install --with-deps chromium`.
  3. Run `npx playwright test e2e/gallery-visual.test.ts`.
  4. Refresh the PNG files with `npm run test:e2e:visual-baselines`.
     That command runs the official Playwright noble image for the pinned Playwright version.
     The image matches Ubuntu 24.04 after `npx playwright install --with-deps chromium`.
     The gallery font stack resolves to Liberation Mono there.
     A machine that has Cascadia Mono does not match those pixels.
- Check:
  - The command exits 0.
  - `e2e/gallery-visual.test.ts-snapshots/` contains 24 PNG files.
  - `npx vitest run src/lib/client/tui/visual-shots.test.ts` passes.
  - `npm run test:e2e` passes.
- Code and tests:
  - Code: `src/lib/client/tui/visual-shots.ts`.
  - Tests: `src/lib/client/tui/visual-shots.test.ts`, `e2e/gallery-visual.test.ts`, and the PNG files Playwright writes beside that test.

## Toolchain maintenance (M4 slice 6)

Node 22.17 is the minimum. drizzle-kit is pinned to 0.31.11. The esbuild override is `$esbuild`. npm audit reports no advisory.

- Entry point: `package.json` field `engines`, and `.github/workflows/ci.yml`.
- Use:
  1. Install Node 22.23.3 and put its bin directory first on PATH.
  2. Run `npm ci`.
  3. Run `npm audit`.
- Check:
  - `node -v` prints v22.23.3, or another Node 22 version that is 22.17.0 or later.
  - `npm audit` exits 0.
  - `npx vitest run scripts/toolchain-pin.test.ts scripts/toolchain-pin-edge.test.ts` exits 0.
- Code and tests:
  - Code: `package.json`, `package-lock.json`, `.github/workflows/ci.yml`, `CONTRIBUTING.md`, `scripts/toolchain-pin-check.ts`.
  - Tests: `scripts/toolchain-pin.test.ts` and `scripts/toolchain-pin-edge.test.ts`.

## Migration generate

`npm run db:generate` compares the schema with the current migration folders. An unchanged schema does not write a new migration. The generate scripts set `TSX_DISABLE_CACHE` to 1.

- Entry point: `npm run db:generate`.
- Use:
  1. Run the SETUP path export.
  2. Run `npm ci`.
  3. Run `npm run db:generate`.
- Check:
  - The command exits 0.
  - The output contains `No schema changes, nothing to migrate` two times.
  - `git diff --exit-code -- drizzle` exits 0.
  - `npx vitest run scripts/db-generate.test.ts` exits 0.
- Code and tests:
  - Code: `package.json`, `package-lock.json`, `.github/workflows/ci.yml`, `scripts/db-generate.mjs`.
  - Tests: `scripts/db-generate.test.ts`, `scripts/toolchain-pin.test.ts`, `scripts/toolchain-pin-edge.test.ts`, `scripts/ci-workflow.test.ts`.

## Performance bench and bundle guard

A repeatable bench times study next, answer, deck list, and note read. CI rejects a client JS gzip sum above 90000 bytes. Results and auth behavior stay the same.

- Entry point: `npx tsx scripts/perf-bench.ts`. CI step `node scripts/bundle-budget.mjs` after `npm run build`.
- Use:
  1. Run the SETUP commands.
  2. Run `npx tsx scripts/perf-bench.ts --decks 20 --notes-per-deck 500 --warmup 5 --runs 30`.
  3. Read the median and p95 lines.
  4. Run `npm run build`.
  5. Run `node scripts/bundle-budget.mjs`.
- Check:
  - The bench exits 0.
  - SQLite all-deck next median is 17 ms or less.
  - The budget command exits 0 on a current build.
  - `npx vitest run scripts/perf-bench-stats.test.ts scripts/bundle-budget.test.ts` exits 0.
- Code and tests:
  - Code: `src/lib/server/study/store/snapshot-batch.sqlite.ts`, `src/lib/server/study/store/snapshot-batch.pg.ts`, `src/lib/server/read-cache.ts`, `src/lib/client/sign-out.ts`, `scripts/perf-bench.ts`, `scripts/bundle-budget.mjs`.
  - Tests: `src/lib/server/study/store/snapshot-batch.test.ts`, `src/lib/server/read-cache.test.ts`, `scripts/perf-bench-stats.test.ts`, `scripts/bundle-budget.test.ts`.

## Deck list (M5 slice 9)

A signed-in home page shows the deck tree with New, Learning, and Due counts. The user can create, rename, and delete a deck.

- Entry point: browser path `/` after sign-in. API `GET /api/decks/counts`.
- Use:
  1. Start the server and sign in (see "Authentication (M1)").
  2. Open `/`.
  3. Create a deck named `Languages`.
  4. Create a child named `Spanish`.
  5. Create a child named `French`.
  6. The rows are `Languages`, `French`, `Spanish`.
  7. Press Home. ArrowDown selects `French`. ArrowDown again selects `Spanish`.
  8. Read the New, Learning, and Due numbers on each row.
- Check:
  - `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/decks/counts` prints `401`.
  - `npx vitest run src/lib/client/app src/lib/server/study/deck-counts.test.ts src/routes/api/decks/counts` exits 0.
  - `npx playwright test e2e/deck-list.test.ts` exits 0.
- Code and tests:
  - Code: `src/lib/client/app/`, `src/lib/server/study/deck-counts.ts`, `src/lib/server/study/core/deck-count-rollup.ts`, `src/routes/api/decks/counts/+server.ts`, `src/routes/+page.svelte`, `src/lib/server/http/private-page.ts`, `src/routes/+page.server.ts`, `src/lib/client/tui/CommandPalette.svelte`.
  - Tests: `src/lib/client/app/*.test.ts`, `src/lib/server/study/deck-counts.test.ts`, `src/routes/api/decks/counts/server.test.ts`, `e2e/deck-list.test.ts`.

## Study screen (M5 slice 10)

A signed-in study page shows a card, reveals the back, and records a rating. It can undo, suspend, and edit the note fields. A second key while a request is in flight returns none. Space or Enter on a button returns none, so that button runs once. The client JS gzip sum was 60533 at de4be76. This slice measures 67392. The cap is 90000.

- Entry point: browser path `/study` after sign-in. Optional query `deck` with a deck id.
- Use:
  1. Sign in and add a Basic note (see "Decks, notes and media (M2)").
  2. Open `/study?deck=<deck id>`.
  3. Press Space to reveal the back.
  4. Press 4 to rate Easy.
  5. Read `No cards left.` when that card was the only card.
- Check:
  - `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/study/next` prints `401`.
  - `npx vitest run src/lib/client/card src/lib/client/app/study-keys.test.ts src/routes/study` exits 0.
  - `npx playwright test e2e/study-screen.test.ts` exits 0.
- Code and tests:
  - Code: `src/lib/client/card/sanitize-card.ts`, `src/lib/client/card/CardHtml.svelte`, `src/lib/client/app/StudyScreen.svelte`, `src/lib/client/app/format-until.ts`, `src/lib/client/app/study-elapsed.ts`, `src/lib/client/app/study-paths.ts`, `src/lib/client/app/study-parse.ts`, `src/lib/client/app/study-client.ts`, `src/lib/client/app/study-state.ts`, `src/routes/study/+page.svelte`.
  - Tests: `src/lib/client/card/sanitize-card.test.ts`, `src/lib/client/app/study-keys.test.ts`, `src/routes/study/`, `e2e/study-screen.test.ts`.

## Note editor (M5 slice 11)

A signed-in page edits note fields, tags, and the deck. A live preview shows the cards. Cloze buttons and media upload are on the page.

- Entry point: browser path `/notes/new` and `/notes/<id>` after sign-in.
- Use:
  1. Sign in and open `/notes/new`.
  2. Choose Basic and deck `Spanish`.
  3. Type front `gato` and back `cat`. Type tag `animals`.
  4. Press Save.
  5. Open the saved note. The fields are still `gato` and `cat`.
- Check:
  - `curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3000/api/notes/preview -H 'content-type: application/json' -d '{}'` prints `401`.
  - `npx vitest run src/lib/server/domain/note-preview.test.ts src/routes/api/notes/preview` exits 0.
  - `npx playwright test e2e/note-editor.test.ts` exits 0.
  - A failed preview shows `The preview failed.` in an alert. `npx playwright test e2e/note-editor-race.test.ts` exits 0.
- Code and tests:
  - Code: `src/lib/server/domain/note-preview.ts`, `src/routes/api/notes/preview/+server.ts`, `src/lib/client/app/NoteEditor.svelte`.
  - Tests: `src/lib/server/domain/note-preview.test.ts`, `src/routes/api/notes/preview/server.test.ts`, `e2e/note-editor.test.ts`.

## Browse screen (M5 slice 13)

A signed-in page searches cards and runs bulk move, tag, suspend, and delete.

- Entry point: browser path `/browse` after sign-in.
- Use:
  1. Sign in and add three notes (see "Note editor (M5 slice 11)").
  2. Open `/browse`.
  3. Search `tag:animals`.
  4. Select a row. Press `Add tag` or `Confirm delete` as needed.
- Check:
  - `npx playwright test e2e/browse-screen.test.ts` exits 0.
  - `npx vitest run src/lib/client/app/browse-keys.test.ts` exits 0.
- Code and tests:
  - Code: `src/lib/client/app/BrowseScreen.svelte`, `src/routes/browse/+page.svelte`.
  - Tests: `src/lib/client/app/browse-keys.test.ts`, `e2e/browse-screen.test.ts`.

## Browse query (M5 slice 12)

A signed-in client can search cards and can tag or trash notes in one transaction.

- Entry point: `GET /api/browse?q=tag:animals`. Bulk: `POST /api/notes/tags` and `POST /api/notes/trash`.
- Use:
  1. Sign in and add notes (see "Decks, notes and media (M2)").
  2. Call `GET /api/browse?q=tag:animals&limit=50`.
  3. Call `POST /api/notes/tags` with `noteIds`, `add`, and `remove`.
- Check:
  - `curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:3000/api/browse?q=tag:animals'` prints `401`.
  - `npx vitest run src/lib/server/browse src/routes/api/browse src/routes/api/notes/tags src/routes/api/notes/trash src/lib/server/domain/store/note-bulk-plan.test.ts src/lib/server/domain/store/note-bulk.sqlite.test.ts src/lib/server/domain/store/note-bulk.pg.test.ts` exits 0.
- Code and tests:
  - Code: `src/lib/server/browse/`, `src/lib/server/domain/store/note-bulk.sqlite.ts`, `src/lib/server/domain/store/note-bulk.pg.ts`, `src/lib/server/domain/store/note-bulk-plan.ts`, `src/routes/api/browse/+server.ts`, `src/routes/api/notes/tags/+server.ts`, `src/routes/api/notes/trash/+server.ts`.
  - Tests: `src/lib/server/browse/*.test.ts`, `src/routes/api/browse/server.test.ts`, `src/routes/api/notes/tags/server.test.ts`, `src/routes/api/notes/trash/server.test.ts`, `src/lib/server/domain/store/note-bulk*.test.ts`.
