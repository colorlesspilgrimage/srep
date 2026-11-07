# Upgrading to srep 2.0 (Rust + WASM)

srep 2.0 is the default stack: a single Rust binary (`srep-server`) and a Leptos WASM client. The **database schema is unchanged** from v1; existing `sqlite:/data/srep.db` files work after sqlx migrations run on startup.

## Docker

The root `Dockerfile` is the Rust multi-stage image:

```bash
docker compose up --build
# or
docker build -t srep:2.0.0 .
docker run --rm -p 3000:3000 -v srep-data:/data \
  -e SREP_ORIGIN=https://your.host \
  -e SREP_RP_ID=your.host \
  srep:2.0.0
```

## CLI

`srep reset-auth --yes` ships in the Rust `srep` binary (same env vars as v1).

## TypeScript v1

The SvelteKit app lives under `legacy/v1-sveltekit/` for reference. It is not part of the supported 2.0 product path.

## Performance

See `docs/perf-v2.md` (generate with `cargo bench` once study paths are fully ported).
