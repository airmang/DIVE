#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

pattern='MockProvider|providers/mock\.rs|mock-model|mock mutex poisoned'
artifact_names=(
  dive
  dive.exe
  libdive_lib.dylib
  libdive_lib.a
  libdive_lib.so
  dive_lib.dll
  dive_lib.lib
  dive.dll
  dive.lib
)
artifact_dirs=(target/release)
release_targets=(
  "${CARGO_BUILD_TARGET:-}"
  "${TARGET:-}"
  "${TAURI_BUILD_TARGET:-}"
  "${DIVE_RELEASE_TARGET:-}"
  x86_64-pc-windows-msvc
  aarch64-pc-windows-msvc
)

add_artifact_dir() {
  local dir="$1"
  [[ -n "$dir" ]] || return 0
  for existing in "${artifact_dirs[@]}"; do
    [[ "$existing" == "$dir" ]] && return 0
  done
  artifact_dirs+=("$dir")
}

for target in "${release_targets[@]}"; do
  [[ -n "$target" ]] || continue
  add_artifact_dir "target/$target/release"
done

artifact_paths() {
  local dir name
  for dir in "${artifact_dirs[@]}"; do
    for name in "${artifact_names[@]}"; do
      printf '%s/%s\n' "$dir" "$name"
    done
  done
}

scan_artifacts() {
  local found=1
  local artifact matches
  while IFS= read -r artifact; do
    [[ -f "$artifact" ]] || continue
    matches="$(strings "$artifact" | rg -n -o "$pattern" || true)"
    if [[ -n "$matches" ]]; then
      printf '%s\n' "$matches" | sed "s#^#$artifact:#" | head -20
      found=0
    fi
  done < <(artifact_paths)
  return "$found"
}

if [[ "${DIVE_RELEASE_MOCK_GUARD_SCAN_ONLY:-}" == "1" ]]; then
  case "${DIVE_RELEASE_MOCK_GUARD_EXPECT:-markers}" in
    clean)
      if scan_artifacts; then
        echo "[release-mock-guard] ERROR: scan-only fixture expected clean artifacts" >&2
        exit 1
      fi
      exit 0
      ;;
    markers)
      if ! scan_artifacts; then
        echo "[release-mock-guard] ERROR: scan-only fixture expected dev-mock markers" >&2
        exit 1
      fi
      exit 0
      ;;
    *)
      echo "[release-mock-guard] ERROR: unknown scan-only expectation" >&2
      exit 2
      ;;
  esac
fi

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
