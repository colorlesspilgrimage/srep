#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
export SREP_DATABASE_URL="${SREP_DATABASE_URL:-sqlite:/tmp/srep-study-sim.db}"
days="${1:-20}"
if [[ "$days" == "--days" ]]; then
  days="${2:-20}"
fi
cargo test -p srep-study simulation_twenty_days_zero_violations -- --nocapture
cargo run -q -p srep-cli -- study-simulate --days "$days" --seed 20260101
