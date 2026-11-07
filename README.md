# srep

[![rust-ci](https://github.com/colorlesspilgrimage/srep/actions/workflows/rust-ci.yml/badge.svg?branch=main)](https://github.com/colorlesspilgrimage/srep/actions/workflows/rust-ci.yml)
[![ci](https://github.com/colorlesspilgrimage/srep/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/colorlesspilgrimage/srep/actions/workflows/ci.yml)

srep is an open-source, self-hosted spaced-repetition web app (an Anki alternative) with an xAI-inspired sparse UI, passwordless single-user auth, and a database backend.

**2.0** ships as a Rust server (`srep-server`), sqlx persistence, and a Leptos WASM UI. The legacy Node/SvelteKit stack is archived under [`legacy/v1-sveltekit/`](legacy/v1-sveltekit/README.md).

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

### Docker

```bash
docker compose up --build
```

Open http://localhost:3000 and follow setup (passkey enrollment).

### Local development

```bash
rustup toolchain install 1.89.0
export SREP_DATABASE_URL=sqlite:/tmp/srep.db
export SREP_ORIGIN=http://127.0.0.1:3000
export SREP_RP_ID=localhost
./scripts/build-wasm.sh
just dev
# or: cargo run -p srep-server
```

## Tests

```bash
cargo test --workspace
cargo clippy --workspace -- -D warnings
SREP_E2E_RUST=1 npm run test:e2e
```

Playwright boots `srep-server` when `SREP_E2E_RUST=1` (see `playwright.config.ts`).

## Docs

- [Installation](docs/install.md)
- [Upgrading from v1](docs/v2-upgrade.md)
- [OpenAPI (companion API)](docs/openapi.yaml)
- [Roadmap](ROADMAP.md) · [v2 milestones](ROADMAP-v2.md)
- [iOS pairing](docs/ios-pairing.md)

## Licence

MIT — see [LICENSE](LICENSE).
