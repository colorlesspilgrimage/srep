# Schema sync (v1 Drizzle → v2 sqlx migrations)

Until R10 cutover, **Drizzle is the source of truth** for schema changes.

1. Edit schemas under `src/lib/server/db/schema/{sqlite,pg}.ts`.
2. Run `npm run db:generate` and commit new files under `drizzle/sqlite/` and `drizzle/pg/`.
3. Copy the new SQL into `migrations/sqlite/` and `migrations/postgres/` with the same ordinal prefix (next `000N_*` file in each tree).
4. Rust `srep-db` applies only `migrations/{sqlite,postgres}/` — keep filenames sequential.

CI should keep both trees in sync before cutover (see R9).
