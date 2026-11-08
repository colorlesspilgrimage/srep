# srep v1 (SvelteKit + Node)

This tree is **archived** as of srep **2.0.0**. The supported product stack is Rust (`srep-server`), sqlx migrations under `migrations/`, and the Leptos WASM client in `frontend/`.

## Contents

| Path | Role |
|------|------|
| `src/` | SvelteKit app, API routes, and Drizzle-backed server code |
| `drizzle/` | Historical Drizzle migration SQL (kept for schema diff vs `migrations/`) |
| `drizzle.*.config.ts`, `vite.config.ts` | v1 build tooling |
| `static/` | v1 PWA static assets |
| `scripts/` | v1 CLI helpers, vitest suites, bundle budgets |
| `Dockerfile.v1.node` | Former default `Dockerfile` (Node multi-stage image) |
| `docs/` | Archived v1 docs (feature map, architecture, config, contributing) |
| `e2e-gallery/` | Archived Playwright tests for the v1 `/gallery` route (theme showcase) |

## Running v1 locally (unsupported)

Use a pre-2.0 git tag; the archived tree no longer matches the slim root `package.json`.

Security fixes for v1.x may be backported on request; new features land only in v2.
