# srep v2 rewrite milestones (R0–R10)

OpenAPI contract: [docs/openapi.yaml](docs/openapi.yaml). Schema policy: [docs/schema-sync.md](docs/schema-sync.md).

| Milestone | Scope | Gate |
|-----------|--------|------|
| R0 | Cargo workspace, migrations, healthz, Docker profile | `cargo test --workspace` |
| R1 | Auth + CLI reset-auth | Auth Rust tests + `e2e/auth.test.ts` on `srep-server` |
| R2 | Domain APIs | Domain tests + contracts |
| R3 | Study + FSRS | Study tests + perf SLO |
| R4 | TUI shell, themes, keyboard | Gallery E2E |
| R5 | Leptos product screens | Full-loop E2E |
| R6 | Import/export/backup | Import tests + CLI |
| R7 | Stats + optimizer | Stats tests |
| R8 | PWA + static assets | Manifest + SW smoke |
| R9 | Hardening, release | Dual-DB CI, authz sweep — **done** |
| R10 | Cutover | Archive v1, v2.0.0 — **done** |
