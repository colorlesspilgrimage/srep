# srep v2 (Rust + WASM)

This is the **full-stack rewrite** track: Axum API, sqlx persistence, Leptos WASM UI.

| Component       | Path                           |
| --------------- | ------------------------------ |
| HTTP server     | `crates/srep-server`           |
| Auth / WebAuthn | `crates/srep-auth`             |
| Domain API      | `crates/srep-domain`           |
| Study / FSRS    | `crates/srep-study`            |
| WASM UI         | `frontend` (`srep-ui`)         |
| Static shell    | `site/`                        |
| Migrations      | `migrations/{sqlite,postgres}` |

## Quick start

```bash
rustup toolchain install 1.89.0
export SREP_DATABASE_URL=sqlite:/tmp/srep.db
export SREP_ORIGIN=http://127.0.0.1:3000
export SREP_RP_ID=localhost
just dev
# or: cargo run -p srep-server
```

Build the WASM client (writes `site/pkg/` and copies the PWA manifest/icons):

```bash
./scripts/build-wasm.sh
# or: just wasm
```

Open http://127.0.0.1:3000 — the bootstrap shim loads `/pkg/srep_ui.js` when present; otherwise it shows build instructions.

### Playwright against `srep-server`

```bash
SREP_E2E_RUST=1 npx playwright test e2e/health.test.ts
```

With `SREP_E2E_RUST=1`, `playwright.config.ts` starts `cargo run -p srep-server` instead of the legacy Node build.

## Status

Milestone **R0** (workspace, healthz, migrations, Docker, CI) is implemented. **R1–R10** routes and crates exist; many handlers return structured stubs while domain logic is ported from TypeScript. See the rewrite plan todos in the agent run.

Legacy v1 remains the default `Dockerfile` until cutover ([docs/v2-upgrade.md](docs/v2-upgrade.md)).
