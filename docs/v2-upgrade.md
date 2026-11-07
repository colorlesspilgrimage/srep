# Upgrading to srep v2 (Rust + WASM)

srep v2 replaces the Node/SvelteKit server with a single Rust binary (`srep-server`) and a Leptos WASM client. The **database schema is unchanged** from v1; existing `sqlite:/data/srep.db` files work after migration SQL is applied.

## Docker

Use `Dockerfile.rust` until v2 becomes the default image:

```bash
docker build -f Dockerfile.rust -t srep:v2 .
docker run --rm -p 3000:3000 -v srep-data:/data \
  -e SREP_ORIGIN=https://your.host \
  -e SREP_RP_ID=your.host \
  srep:v2
```

## CLI

`srep reset-auth --yes` is provided by the Rust `srep` binary (same env vars as v1).

## TypeScript v1

The legacy stack remains in this repository until cutover (Milestone R10). Security fixes for v1.x may continue on `main` during the transition.

## Performance

See `docs/perf-v2.md` (generate with `cargo bench` once study paths are ported).
