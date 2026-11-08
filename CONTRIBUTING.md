# Contributing to srep

## Rust development

- Toolchain: Rust 1.89.0 (`rust-toolchain.toml`).
- Tests: `cargo test --workspace`
- Lint: `cargo clippy --workspace -- -D warnings`
- Format: `cargo fmt --all -- --check`
- Migrations: `sqlx` files under `migrations/`. Never edit a committed migration.
- Shortcuts: `just dev`, `just test`, `just wasm`, `just fmt`.

## E2E tests

- Node >=22.17 is only needed for Playwright e2e.
- Run: `SREP_E2E_RUST=1 npm run test:e2e`

## Style

Write to ASD-STE100. Use short sentences. Use active voice.

## Legacy

v1 (SvelteKit) docs live in `legacy/v1-sveltekit/docs/`, including the old CONTRIBUTING.md.
