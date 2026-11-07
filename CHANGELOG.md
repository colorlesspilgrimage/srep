# Changelog

## Unreleased

## 2.0.0

- Full stack cutover to Rust (`srep-server`), sqlx migrations, and Leptos WASM UI.
- v1 Node/SvelteKit code archived under `legacy/v1-sveltekit/`.
- Docker default image builds from root `Dockerfile` (Rust). Compose runs a single `srep` service.
- CLI: `srep reset-auth`, `backup`, `restore` (Rust binary).

## 1.0.0 (pre-cutover)

- iOS companion pairing: short-lived pairing codes + QR in Settings → Pair app, Bearer API tokens for native clients, OpenAPI and pairing docs.

## 1.0.0

- Stats screen with review heatmap, retention, forecast, streaks, and FSRS optimizer preview/apply.
- PWA manifest and static-asset service worker.
- Security hardening: API authz sweep, dependency audit in CI.
- Documentation set for install, config, architecture, and threat model.
- Multi-arch Docker release workflow on version tags.

## 0.x (M0–M6)

- WebAuthn auth, decks/notes/cards, FSRS study, browse, settings, import/export/backup.
