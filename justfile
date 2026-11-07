# Developer shortcuts for the Rust v2 stack

default:
    cargo build -p srep-server

dev:
    #!/usr/bin/env bash
    set -euo pipefail
    export SREP_DATABASE_URL="${SREP_DATABASE_URL:-sqlite:/tmp/srep-dev.db}"
    export SREP_ORIGIN="${SREP_ORIGIN:-http://127.0.0.1:3000}"
    export SREP_RP_ID="${SREP_RP_ID:-localhost}"
    cargo run -p srep-server

test:
    cargo test --workspace

wasm:
    ./scripts/build-wasm.sh

wasm-dev:
    PROFILE=dev ./scripts/build-wasm.sh

fmt:
    cargo fmt --all
