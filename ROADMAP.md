# srep Roadmap: zero code to v1.0

srep is an open-source, self-hosted spaced-repetition web app (an Anki alternative) with a TUI-style interface, passwordless single-user auth, and a database backend. It works on desktop and mobile.

## 1. Product decisions (fixed for 1.0)

| Area | Decision | Reason |
|---|---|---|
| Users | Exactly one account per instance | Matches the brief. It removes multi-tenancy, sharing and permissions. |
| Auth | WebAuthn only: passkeys (platform) and roaming security keys (YubiKey etc.). No passwords. | Matches the brief. |
| Bootstrap | First run shows a one-time setup page, gated by a setup token printed to server logs. It enrolls the first credential. After that, setup is permanently locked. | Stops a stranger on the internet from claiming a fresh instance. |
| Recovery | Enrollment of at least 2 credentials is encouraged. 10 one-time recovery codes are shown once at setup (stored hashed). A CLI command `srep reset-auth` works with host access. | A lost key must not mean a lost deck. |
| Scheduler | FSRS (open-source, same as modern Anki). Per-deck-preset parameters, plus an optimizer later. | FSRS beats SM-2 on retention per review. |
| Stack | TypeScript. SvelteKit (adapter-node) for UI and API, Drizzle ORM, `@simplewebauthn/server`, `ts-fsrs`. | One language and one deployable. Mature WebAuthn and FSRS libraries exist. |
| Database | SQLite (WAL) by default, one file, easy backup. Postgres supported through the same Drizzle schema, with CI running both. | Single-user self-hosting suits SQLite. Postgres is the escape hatch. |
| Deploy | One Docker image plus a compose file. A reverse proxy with TLS is required because WebAuthn needs HTTPS (localhost is exempt). | |
| UI | TUI aesthetic in the browser: monospace grid, box-drawing borders, keyboard-first, no images or rounded corners. Themes are CSS variables. Touch targets and layout adapt on mobile. | |
| Offline | Not in 1.0. The app is an installable PWA that needs the network. Offline review sync is post-1.0. | Sync and conflict handling is a large separate project. |
| Licence | MIT | Permissive and simple. Matches the OSS goal. |

## 2. Backend design: decks and cards

### 2.1 Principles

1. **Content and scheduling are separate.** What you learn (notes) is independent of when you see it (card state). Editing a note never resets history.
2. **Reviews are an append-only log.** Card state is a cache that can be rebuilt by replaying the log. This allows changing the scheduler, re-optimizing FSRS, and undoing mistakes safely.
3. **Decks are organizational, not owners.** A card sits in exactly one deck. A deck is a node in a tree and holds a settings preset.
4. **Everything is exportable.** Lossless export is a feature, not an afterthought.

### 2.2 Schema (logical)

```
auth_credential   id, credential_id (unique), public_key, sign_count, transports,
                  kind (passkey|security_key), nickname, created_at, last_used_at
auth_recovery     id, code_hash, used_at
session           id, token_hash, created_at, expires_at, user_agent
app_settings      key, value (JSON): theme, font size, day rollover hour, timezone, keybind overrides

note_type         id, name, fields (JSON ordered list), css_class, sort_field_idx
card_template     id, note_type_id, name, ordinal, front_tpl, back_tpl
                  -- templates are plain text with {{Field}} substitution,
                  -- {{#Field}}...{{/Field}} conditionals, and {{cloze:Field}}
note              id, note_type_id, guid (stable across export/import),
                  fields (JSON array, ordered), tags (normalized, see note_tag),
                  created_at, updated_at, checksum (first-field hash, duplicate detection)
note_tag          note_id, tag             -- indexed
deck              id, parent_id (nullable), name, path (materialized "A::B::C", unique),
                  preset_id, description, archived_at
deck_preset       id, name, new_per_day, reviews_per_day, desired_retention (default 0.9),
                  learning_steps, relearning_steps, max_interval, fsrs_params (JSON),
                  bury_siblings, new_order (added|random)
card              id, note_id, template_id (ordinal for cloze index), deck_id,
                  state (new|learning|review|relearning|suspended|buried),
                  due (timestamp), stability, difficulty, last_review, reps, lapses,
                  position (for new-card order), buried_until, flags
review_log        id, card_id, reviewed_at, rating (1-4), state_before, due_before,
                  stability_before, difficulty_before, elapsed_ms, interval_after
                  -- append-only, never updated
media             id, sha256 (unique), mime, size, original_name   -- content-addressed files
                  on disk next to the DB, referenced from fields via {{media:sha}} tokens
```

### 2.3 Decks behaviour

- **Hierarchy:** `Languages::Japanese::Kanji`. The path is materialized and indexed, so subtree queries are a prefix match. Renaming or moving a deck rewrites paths in one transaction.
- **Study scope:** studying a deck includes all descendants. Daily limits come from each card's own deck preset, so a parent cannot silently override a child.
- **Presets:** shared, named setting bundles. A deck points at one preset, and children default to their parent's preset at creation time.
- **Note type to cards:** saving a note runs its templates and creates or removes cards. Basic yields 1 card, Basic+Reversed yields 2, and Cloze yields one per distinct `{{c1::...}}` index. Empty-front cards are skipped. Removing a cloze deletes its card only if unreviewed. Otherwise it is suspended for the user to confirm.
- **Moving cards:** a card can move between decks without touching its history.
- **Filtered/custom study:** a saved query (deck, tag, state, due window, lapses over N) generates a temporary study session. It does not move cards, so there is no "home deck" bookkeeping.
- **Suspend and bury:** suspend is indefinite. Bury expires at the next day rollover. Sibling burying is controlled by the preset.
- **Day rollover:** a configurable hour (default 04:00) in the user's timezone defines "today", so late-night study counts as one day.
- **Queue building:** per request, for a deck subtree: (1) due learning cards, (2) due review cards up to the daily limit, (3) new cards up to the daily limit, interleaved with reviews. Counts come from `review_log` for today, so limits survive restarts.
- **Undo:** reverts the last review by restoring the `*_before` columns and deleting that log row. It is only allowed for the most recent review.
- **Deletion:** deleting a deck either moves cards to a chosen deck or deletes its notes. A confirmation page shows counts. Deleted notes are soft-deleted for 30 days (trash).

### 2.4 API shape

JSON over HTTPS with cookie sessions (`HttpOnly`, `Secure`, `SameSite=Strict`) and CSRF protection on all mutating routes. Resources are `/api/decks`, `/api/notes`, `/api/cards`, `/api/study/next`, `/api/study/answer`, `/api/stats`, `/api/import`, `/api/export`, `/api/settings`, and `/api/auth/*`. The UI is the only first-party client, but the API is documented (OpenAPI) so that a CLI or third-party client is feasible later.

## 3. UI design

- **Layout:** a fixed-width character grid with `ch`-based sizing. Panes use box-drawing borders and a status line at the bottom that shows the mode and key hints. A command palette (`:` or `Ctrl+K`) reaches every action.
- **Desktop:** a multi-pane layout: deck tree on the left, content on the right. It is fully keyboard-driven, with vim-like navigation (`j/k`, `Enter`, `Esc`), `1-4` or `Space` to rate, and remappable keys.
- **Mobile:** a single pane with a bottom tab bar (Decks, Study, Browse, Settings). Rating uses 4 large thumb-reachable buttons. Gestures are optional and never required. Layout respects safe-area insets and avoids hover-only affordances. Minimum touch target is 44px. The virtual keyboard must not cover the editor.
- **Themes:** a settings pane with live preview. Themes are token maps (`bg, fg, dim, accent, good, warn, bad, border, selection`) and ship pre-made:
  Phosphor Green, Amber CRT, Solarized Dark/Light, Gruvbox Dark/Light, Nord, Dracula, Monokai, Tokyo Night, VT100 White-on-Black, and a high-contrast theme. Themes must pass WCAG AA contrast on body text, checked in CI.
- **Font:** a bundled monospace font (self-hosted, no CDN), with size and optional scanline or cursor-blink effects. A `prefers-reduced-motion` setting disables the effects.
- **Card rendering:** card content is sanitized HTML/Markdown subset rendered inside the theme. It never executes scripts. Cloze, images and audio are supported.
- **Accessibility:** the TUI look must not harm screen readers. It uses real semantic elements, ARIA labels and visible focus states.

## 4. Milestones

Each milestone ends with something runnable and with passing tests. Rough sizing is S (days), M (about 1-2 weeks), L (2+ weeks).

### M0: Foundations (S)
- Repo, licence, README, CONTRIBUTING, code of conduct, `.editorconfig`.
- SvelteKit + TypeScript strict, ESLint, Prettier, Vitest, Playwright.
- CI: lint, typecheck, unit tests, e2e on SQLite and Postgres.
- Drizzle setup, migration runner, config via environment variables, structured logging.
- Dockerfile and compose with a health endpoint.
- **Exit:** `docker compose up` serves a blank page and `/healthz` returns OK. CI is green.

### M1: Authentication (L)
- First-run setup flow with a setup token, then the lock.
- Passkey registration and login (discoverable credentials, user verification preferred).
- Security-key enrollment (cross-platform authenticator attachment) and login. Several credentials with nicknames. List, rename and revoke them. Refuse to revoke the last credential.
- Recovery codes plus the `srep reset-auth` CLI.
- Sessions: secure cookies, idle and absolute expiry, "log out everywhere", rate limiting, CSRF, and security headers (CSP, HSTS, etc.).
- Config for RP ID and origin, with clear startup errors on a mismatch.
- Tests: use a virtual authenticator (Playwright / CDP) for passkey and security-key flows. Cover replay (sign counter), wrong origin, expired challenge, and setup after lock.
- **Exit:** you can register, log out, log in with a passkey, and log in with a security key, in Chrome, Firefox and Safari. An unauthenticated request to any `/api` route other than auth returns 401.

### M2: Data model and core domain (M)
- Schema and migrations from section 2.2, behind a repository layer.
- Note types: Basic, Basic+Reversed, Cloze, plus custom note types with a template engine.
- Deck tree operations: create, rename, move, delete, presets.
- Note to card generation and reconciliation.
- Media store (content-addressed, with size and MIME limits).
- Domain unit tests, plus property tests for deck-path moves and cloze parsing.
- **Exit:** an API or script can create decks and notes and produce the expected cards.

### M3: Scheduler and study engine (M)
- Integrate `ts-fsrs`. Learning and relearning steps, the day-rollover clock, and daily limits.
- Queue builder, answer endpoint, undo, suspend and bury, sibling burying.
- The `review_log` and state-rebuild routine, verified by replaying the log against stored card state.
- Deterministic tests with an injected clock, and golden tests against known FSRS outputs.
- **Exit:** a simulated 365-day study run with a fake clock stays consistent: limits are respected, replay equals the cached state, and undo restores the exact prior state.

### M4: TUI shell and theming (M)
- Design tokens, the character-grid layout system, the pane, border, list, form, modal and status-line components.
- Keyboard layer: focus management, a command palette, a key hint bar, and remapping.
- All pre-made themes, the settings pane with live preview, and persistence in `app_settings`. Themes apply without a flash on load.
- A responsive breakpoint system (desktop panes vs. mobile single pane and tab bar).
- Contrast tests per theme, plus visual regression screenshots per theme at desktop and mobile sizes.
- **Exit:** a component gallery page is usable on a 360px phone and a 1440px desktop, and every theme passes contrast.

### M5: Core screens (L)
- **Deck list:** a tree with due/new/learning counts and expand/collapse.
- **Study:** show front, reveal back, rate. Progress is shown, and undo, suspend and edit-in-place are available. Keyboard on desktop, large buttons on mobile. A "congrats" state when finished.
- **Add/edit note:** a field editor with a live card preview, tags, a deck picker, cloze helpers and media upload (including camera/file on mobile).
- **Browse:** a searchable table of cards or notes. Search syntax includes `deck:`, `tag:`, `is:due|new|suspended`, `prop:lapses>3`, and free text. It supports bulk actions: move, tag, suspend and delete.
- **Settings:** theme, display, scheduling presets, security (credentials, recovery codes, sessions), data (import, export, trash).
- E2E tests for the full loop: create a deck, add notes, study them, and see the next due date.
- **Exit:** a user can do the whole daily workflow on desktop and on a phone using only the UI.

### M6: Import, export, backup (M)
- Import Anki `.apkg` (collection SQLite plus media): decks, notes, note types, tags and media. Review history and FSRS state import when present. The importer is dry-run first, with a report listing unsupported features (for example, JavaScript in templates, which is dropped).
- Import CSV/TSV with column mapping.
- Export to a native lossless archive (JSON plus media) and to `.apkg`, CSV and plain text.
- A full DB backup and restore CLI. Documentation on backing up the SQLite file and media directory.
- Round-trip tests: export, import into an empty instance, and compare. Import a corpus of real public `.apkg` decks.
- **Exit:** a real-world Anki deck imports with its media, and a srep export re-imports identically.

### M7: Stats and scheduler tuning (M)
- Today summary, a review heatmap, retention (true retention vs. desired), forecast of upcoming reviews, interval and card-state distributions, and streaks.
- The FSRS optimizer: compute personalized parameters from `review_log` and offer a preview comparison before applying. It is only offered above a minimum review count.
- **Exit:** the stats screens match independently computed numbers on a seeded dataset.

### M8: Mobile and PWA polish (M)
- Web app manifest, icons, installability, a standalone display mode, and theme-colour meta tags that follow the active theme.
- Touch ergonomics pass: tap targets, gestures, viewport and safe-area handling, and virtual-keyboard behaviour in the editor.
- Performance budgets, measured on a mid-range Android device profile: first load under 200 KB gzipped JS for the study screen, and interaction latency under 100 ms. Large decks (100k cards) must keep the deck list and browse screens responsive, using server-side pagination and indexes.
- A service worker that caches only static assets (no offline data).
- Manual test matrix: iOS Safari, Android Chrome, desktop Chrome, Firefox and Safari. Passkey flows are included on each.
- **Exit:** Lighthouse performance and accessibility are 90 or higher on mobile, and the PWA installs on iOS and Android.

### M9: Hardening and release candidate (M)
- Security review: threat model, an OWASP checklist, dependency audit, HTML sanitizer fuzzing (card content is the main injection surface), and an authz test that every route enforces auth.
- Accessibility audit with a screen reader and keyboard-only passes.
- Load and soak tests, migration upgrade tests from every earlier tagged version, and a backup/restore drill.
- Documentation: install guide (Docker and bare metal, reverse proxy examples for Caddy/nginx/Traefik), configuration reference, user guide, keyboard shortcut reference, and an architecture overview.
- A signed multi-arch Docker image (amd64/arm64), a changelog, and SemVer with a migration policy.
- **Exit:** the release candidate has run on a real instance for 2 weeks with no data-loss or auth bugs.

### M10: v1.0 release
- Fix RC bugs only, then tag `v1.0.0`, publish images, and publish the docs site and announcement.

## 5. v1.0 definition of done

- [ ] Single-user passkey and security-key login works, with recovery, and no passwords exist anywhere.
- [ ] Decks, notes (Basic, Reversed, Cloze, custom), tags, media and presets are fully usable from the UI.
- [ ] FSRS scheduling with correct daily limits, undo, suspend and bury.
- [ ] Anki `.apkg` import, and lossless native export.
- [ ] TUI interface with 10 or more pre-made terminal themes, a settings pane and live preview.
- [ ] Usable by keyboard on desktop and by touch on mobile, installable as a PWA.
- [ ] Stats, plus FSRS optimizer.
- [ ] CI green on SQLite and Postgres, a security review completed, and docs complete.
- [ ] Docker image published, with upgrade and backup procedures tested.

## 6. Post-1.0 backlog (explicitly out of scope)

- Offline reviewing with sync and conflict resolution.
- Multi-user support, sharing and shared-deck repositories.
- Image occlusion, audio recording and TTS, and LaTeX.
- Add-on or plugin API.
- Native mobile apps, and a CLI client built on the OpenAPI spec.
- Custom user-authored themes (import/export of token maps).
- Additional import sources (SuperMemo, Mnemosyne, Quizlet).

## 7. Key risks

| Risk | Mitigation |
|---|---|
| WebAuthn behaves differently across browsers and platforms | Build M1 first, use the virtual authenticator in CI, and run the manual matrix early (not only in M8). |
| Lockout from lost credentials | Recovery codes, a CLI reset, and a nudge to enroll a second credential. |
| `.apkg` format variants (legacy vs. newer schemas, zstd-compressed collections) | Test against a diverse public deck corpus from the start of M6. Report unsupported features instead of failing. |
| FSRS parameter or library changes alter schedules | Pin versions. The review log allows rescheduling, and golden tests detect drift. |
| TUI aesthetic hurts mobile usability or accessibility | Mobile and a11y are checked in every milestone from M4 on, not saved for the end. |
| XSS through card HTML | Strict sanitizer allowlist, a CSP without `unsafe-inline`, and fuzzing in M9. |
| Large collections slow down | Indexes on `card(deck_id, state, due)`, server-side pagination, and a 100k-card benchmark in M8. |
