#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PROFILE="${PROFILE:-release}"
TARGET=wasm32-unknown-unknown

rustup target add --toolchain "$(rustc +stable -Vv | awk '/^release:/ { print $2 }')" "$TARGET" >/dev/null 2>&1 || true

if [[ "$PROFILE" == "release" ]]; then
  cargo build -p srep-ui --target "$TARGET" --release
  WASM="target/$TARGET/release/srep_ui.wasm"
else
  cargo build -p srep-ui --target "$TARGET"
  WASM="target/$TARGET/debug/srep_ui.wasm"
fi

if ! command -v wasm-bindgen >/dev/null; then
  cargo install wasm-bindgen-cli --version 0.2.130 --locked
fi

mkdir -p site/pkg
wasm-bindgen "$WASM" --out-dir site/pkg --target web --no-typescript

cp -f static/manifest.webmanifest site/manifest.webmanifest
mkdir -p site/icons
cp -f static/icons/*.png site/icons/

echo "WASM bundle written to site/pkg/"
