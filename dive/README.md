# DIVE app

Beginner-friendly desktop UI for controlling a local AI coding agent. Built with Tauri 2.x + React 19 + TypeScript 5 + Vite 7.

- Product version: **1.0.0-rc.2**
- Package metadata: `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` are all `1.0.0-rc.2`.
- Internal spec/coordination docs live in the repository root and `../docs/internal/`.

## Product surface

The product UI is moving toward a beginner mental model:

1. Open a project folder.
2. Describe a goal in natural language.
3. Review the plan.
4. Follow a visible roadmap of steps.
5. Approve tool use with clear safety explanations.
6. Preview changes, run checks, and use checkpoint-based undo.

Existing workmap/card state remains available as internal implementation vocabulary while Phase 8 introduces Roadmap/Step product language.

---

## Requirements

| Item      | Version | Notes                                |
| --------- | ------- | ------------------------------------ |
| Node.js   | 22.19+  | Vite 7, ESLint 9, Pi sidecar build   |
| pnpm      | 10+     | Only supported package manager       |
| Rust      | 1.80+   | No pinned `rust-toolchain` currently |
| Tauri CLI | 2.x     | Invoked through `pnpm tauri`         |

### Additional Windows build requirements

- Visual Studio 2022 Build Tools or newer
  - **C++ desktop development** workload
  - **ARM64 build tools** component for ARM64 NSIS builds
- `rustup target add x86_64-pc-windows-msvc`
- `rustup target add aarch64-pc-windows-msvc`
- WebView2 runtime (included with Windows 11)

---

## Product vs internal tooling

Product-facing work should present DIVE as a beginner desktop UI for controlling a local coding agent. The first-run path is:

1. Choose a project folder.
2. Connect an AI assistant.
3. Describe a goal.
4. Review a plan.
5. Follow the Roadmap.
6. Execute one step at a time with approvals, checks, and Recovery/Undo.

Research, classroom, teacher/student, D/I/V/E, card, and workmap language may remain in internal docs, dev-only demo routes, Rust/database state, tests, and adapters. It should not be the primary copy in the production product route or release screenshots.

---

## Development

```bash
pnpm install
pnpm tauri:dev      # desktop window with hot reload
```

## Verification

Frontend:

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm verify:v4
pnpm format:check
```

Rust:

```bash
cd src-tauri
cargo fmt --all -- --check
cargo check --release
cargo test --features dev-mock --all-targets
cargo clippy --features dev-mock --all-targets -- -D warnings
```

---

## Build

### macOS / Linux local bundle

```bash
pnpm build
pnpm tauri build
```

### Windows x64 NSIS installer

```bash
pnpm tauri:build:x64
# output: src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*.exe
```

### Windows ARM64 NSIS installer

```bash
pnpm tauri:build:arm64
# output: src-tauri/target/aarch64-pc-windows-msvc/release/bundle/nsis/*.exe
```

The Windows build scripts compile and bundle the Pi sidecar first, so the installed
app does not require a separate Node.js runtime. Node SEA sidecar builds are
host-native; build each Windows architecture on its matching runner or machine.

### Both Windows targets

```bash
pnpm tauri:build:all
```

CI builds Windows x64 and ARM64 installers through `.github/workflows/build.yml`.
Use the CI matrix for both Windows architectures; the Pi sidecar uses Node SEA
and must be built on a matching host architecture.

---

## Directory map

```text
dive/
├── src-tauri/                Rust backend
│   └── src/
│       ├── main.rs           Entry point
│       ├── lib.rs            Module setup
│       ├── agent/            Agent loop
│       ├── dive/             Internal state/gate helpers
│       ├── providers/        LlmProvider adapters
│       ├── tools/            Built-in local tools
│       ├── mcp/              MCP client
│       ├── auth/             OS keyring wrapper
│       ├── checkpoint/       git2-rs checkpoint wrapper
│       ├── db/               rusqlite wrapper
│       └── ipc/              Tauri commands
├── src/                      React frontend
│   ├── components/           Shell, chat, roadmap/work-step internals, permissions, settings
│   ├── pages/                Product routes and dev-only demo/internal pages
│   ├── hooks/                Runtime hooks
│   ├── stores/               Zustand stores
│   └── i18n/                 ko / en resources
├── package.json
├── tsconfig.json
├── eslint.config.js
├── .prettierrc.json
└── vite.config.ts
```

The Rust backend includes disk DB, provider runtime, native menu, checkpoints, event log, tool permission, and IPC command surfaces. Development demo routes are separated from the production product route.

---

## Code signing / SmartScreen

Current development builds are not EV code-signed. Windows SmartScreen may show an unknown publisher warning; use `More info → Run anyway` for trusted internal builds. Code signing is tracked separately in packaging docs.

---

## Troubleshooting

| Symptom                                        | Cause                                   | Fix                                                   |
| ---------------------------------------------- | --------------------------------------- | ----------------------------------------------------- |
| `LNK2019: unresolved external symbol` on ARM64 | Missing VS C++ ARM64 build tools        | Add the component in Visual Studio Installer          |
| `git2-rs` build failure                        | System libgit2 unavailable              | Keep `features = ["vendored-libgit2"]`                |
| `openssl-sys` build failure                    | OpenSSL headers unavailable             | Prefer rustls-backed dependencies                     |
| `unknown variant perUser`                      | `tauri.conf.json` NSIS installMode typo | Allowed values: `currentUser` / `perMachine` / `both` |
| `webkit2gtk` Linux build failure               | Missing runtime dependencies            | Install WebKitGTK/libsoup development packages        |

---

## License

MIT (see root `LICENSE`).
