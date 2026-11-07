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

if [[ -f site/manifest.webmanifest ]]; then
  :
elif [[ -f legacy/v1-sveltekit/static/manifest.webmanifest ]]; then
  cp -f legacy/v1-sveltekit/static/manifest.webmanifest site/manifest.webmanifest
fi
mkdir -p site/icons
if compgen -G "site/icons/*.png" >/dev/null; then
  :
elif compgen -G "legacy/v1-sveltekit/static/icons/*.png" >/dev/null; then
  cp -f legacy/v1-sveltekit/static/icons/*.png site/icons/
fi

echo "WASM bundle written to site/pkg/"
