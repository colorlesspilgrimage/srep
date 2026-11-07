# Schema sync (Drizzle archive → sqlx migrations)

**sqlx migrations under `migrations/` are the source of truth** for srep 2.0.

When porting schema changes from the v1 era:

1. Compare with the archived Drizzle SQL in `legacy/v1-sveltekit/drizzle/{sqlite,pg}/`.
2. Add matching `000N_*.sql` files under `migrations/sqlite/` and `migrations/postgres/` (keep ordinals aligned).
3. CI runs `node scripts/check-migrations-sync.mjs` to ensure legacy Drizzle snapshots still match the sqlx trees (parity guard during transition).

Rust `srep-db` applies only `migrations/{sqlite,postgres}/`.
