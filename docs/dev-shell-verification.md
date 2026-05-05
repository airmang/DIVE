# DIVE dev shell verification

Last local verification host: macOS (Darwin) via the repository scripts. Use this checklist before handing a classroom or release build to testers.

## macOS / Linux local checks

```bash
cd dive
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format:check
pnpm verify:production-wire
pnpm verify:version-sync
pnpm verify:v4

cd src-tauri
cargo fmt --all -- --check
cargo clippy --features dev-mock --all-targets -- -D warnings
cargo test --features dev-mock --all-targets
cargo check --release
```

## Interactive dev shell

```bash
cd dive
pnpm tauri:dev
```

Expected result: a Tauri desktop window opens, provider setup appears if no provider is configured, and the chat input is blocked until a provider/session/card gate is satisfied.

## Linux Tauri prerequisites

Install the platform packages listed in `.github/workflows/build.yml` before `pnpm tauri:dev` or `pnpm tauri build` on Linux. The CI package list is the source of truth for Ubuntu-based environments.

## Known external blocker

Full Windows installed-app smoke still requires a Windows host with Edge WebDriver and NSIS bundle execution. On non-Windows hosts, `pnpm release:smoke:preflight` records this as an external blocker rather than a local failure.
