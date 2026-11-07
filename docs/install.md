# Installation

## Docker (recommended)

```bash
docker compose up --build
```

Or pull a release image:

```bash
docker pull <your-registry>/srep:2.0.0
docker run -d --name srep -p 3000:3000 -v srep-data:/data \
  -e SREP_ORIGIN=https://your.host \
  -e SREP_RP_ID=your.host \
  <your-registry>/srep:2.0.0
```

Set `SREP_DATABASE_URL` to a `postgres://` URL instead of the default SQLite volume when using Postgres.

## Bare metal

1. Rust 1.89 (`rust-toolchain.toml`).
2. `cargo build --release -p srep-server`
3. Build the WASM UI once: `./scripts/build-wasm.sh`
4. Run with `SREP_DATABASE_URL`, `SREP_ORIGIN`, and `SREP_RP_ID` set (see `.env.example`).

```bash
export SREP_DATABASE_URL=sqlite:/tmp/srep.db
export SREP_ORIGIN=http://127.0.0.1:3000
export SREP_RP_ID=localhost
./target/release/srep-server
```

The `srep` CLI (`cargo build -p srep-cli`) provides `reset-auth`, `backup`, and `restore`.

## TLS

Terminate TLS with Caddy, nginx, or Traefik in front of port 3000. Set `SREP_ORIGIN` to the public HTTPS origin.

## Upgrade from v1

See [v2-upgrade.md](v2-upgrade.md). Back up first (`srep backup --out backup.zip`), pull the new image or rebuild, restart — migrations run on boot.
