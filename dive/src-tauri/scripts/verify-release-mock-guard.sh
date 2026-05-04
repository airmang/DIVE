#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

pattern='MockProvider|providers/mock\.rs|mock-model|mock mutex poisoned'
artifacts=(target/release/dive target/release/libdive_lib.dylib target/release/libdive_lib.a)

scan_artifacts() {
  local found=1
  for artifact in "${artifacts[@]}"; do
    [[ -f "$artifact" ]] || continue
    matches="$(strings "$artifact" | rg -n -o "$pattern" || true)"
    if [[ -n "$matches" ]]; then
      printf '%s\n' "$matches" | sed "s#^#$artifact:#" | head -20
      found=0
    fi
  done
  return "$found"
}

echo "[release-mock-guard] building default release features"
cargo build --release

if scan_artifacts; then
  echo "[release-mock-guard] ERROR: default release artifacts contain MockProvider/test-only markers" >&2
  exit 1
fi

echo "[release-mock-guard] building release with dev-mock feature"
cargo build --release --features dev-mock

if ! scan_artifacts >/tmp/dive-release-mock-guard-hits.txt; then
  echo "[release-mock-guard] ERROR: dev-mock release did not expose MockProvider markers; guard cannot prove feature gating" >&2
  exit 1
fi

echo "[release-mock-guard] dev-mock markers present only with dev-mock feature"
head -20 /tmp/dive-release-mock-guard-hits.txt
