#!/usr/bin/env bash
set -euo pipefail

repo_script="$(cd "$(dirname "$0")" && pwd)/verify-release-mock-guard.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$tmp/src-tauri/scripts"
cp "$repo_script" "$tmp/src-tauri/scripts/verify-release-mock-guard.sh"
cd "$tmp/src-tauri"

mkdir -p \
  target/release \
  target/x86_64-pc-windows-msvc/release \
  target/aarch64-pc-windows-msvc/release

printf 'release artifact without mock markers\n' > target/x86_64-pc-windows-msvc/release/dive.exe
DIVE_RELEASE_MOCK_GUARD_SCAN_ONLY=1 \
  DIVE_RELEASE_MOCK_GUARD_EXPECT=clean \
  bash scripts/verify-release-mock-guard.sh

printf 'MockProvider marker in Windows exe\n' > target/x86_64-pc-windows-msvc/release/dive.exe
if DIVE_RELEASE_MOCK_GUARD_SCAN_ONLY=1 \
  DIVE_RELEASE_MOCK_GUARD_EXPECT=clean \
  bash scripts/verify-release-mock-guard.sh >/tmp/dive-release-mock-guard-fixture.txt 2>&1; then
  echo "[release-mock-guard-fixture] ERROR: Windows .exe marker was not caught" >&2
  exit 1
fi
DIVE_RELEASE_MOCK_GUARD_SCAN_ONLY=1 \
  DIVE_RELEASE_MOCK_GUARD_EXPECT=markers \
  bash scripts/verify-release-mock-guard.sh >/tmp/dive-release-mock-guard-fixture.txt

rm target/x86_64-pc-windows-msvc/release/dive.exe
printf 'providers/mock.rs marker in Windows dll\n' \
  > target/aarch64-pc-windows-msvc/release/dive_lib.dll
DIVE_RELEASE_MOCK_GUARD_SCAN_ONLY=1 \
  DIVE_RELEASE_MOCK_GUARD_EXPECT=markers \
  bash scripts/verify-release-mock-guard.sh >/tmp/dive-release-mock-guard-fixture.txt

rm target/aarch64-pc-windows-msvc/release/dive_lib.dll
printf 'mock-model marker in Windows import lib\n' > target/release/dive_lib.lib
DIVE_RELEASE_MOCK_GUARD_SCAN_ONLY=1 \
  DIVE_RELEASE_MOCK_GUARD_EXPECT=markers \
  bash scripts/verify-release-mock-guard.sh >/tmp/dive-release-mock-guard-fixture.txt

echo "[release-mock-guard-fixture] Windows artifact scan fixtures passed"
