#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
export SREP_DATABASE_URL="${SREP_DATABASE_URL:-sqlite:/tmp/srep-study-sim.db}"
cargo test -p srep-study -p srep-domain --lib 2>&1
