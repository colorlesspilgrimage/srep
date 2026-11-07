# Architecture

- **SvelteKit** UI + JSON API on **adapter-node**.
- **Domain** module: decks, notes, presets, media (`src/lib/server/domain/`).
- **Study** module: FSRS scheduling, review_log, daily limits (`src/lib/server/study/`).
- **Drizzle** schema with SQLite and Postgres drivers.
- **Stats** reads `review_log` and `card` for aggregates (`src/lib/server/stats/`).

Import/export snapshots use a versioned zip manifest (M6).
