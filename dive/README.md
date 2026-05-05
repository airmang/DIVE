# DIVE

AI 코딩 교육용 데스크톱 앱. Tauri 2.x + React 18 + TypeScript 5 + Vite.

명세: 리포지토리 루트의 [`DIVE_SPEC.md`](../DIVE_SPEC.md).

현재 버전 **1.0.0-rc.2** — production AppState, disk DB, provider runtime, DIVE gate, Settings, native menu, and v4 productization checks are active.

## 제품화 v4 주요 surface

- `Settings > General`이 언어, 테마, 튜토리얼 모드, 연결된 provider model selector의 단일 제품 진입점이다.
- File/View/Help 네이티브 메뉴는 Tauri v2 메뉴 API를 사용하며 frontend `menu:*` event bridge와 연결된다.
- 프로젝트 생성/온보딩은 Tauri v2 dialog folder picker를 우선 사용하고, runtime이 없을 때 수동 경로 입력 fallback을 유지한다.
- `?demo=` route는 개발 모드에서만 lazy-load된다. Production build에서는 demo page 파일을 보존하되 bundle에서 제외하고 product shell로 fallback한다.
- Provider model selection은 `provider_configs.config.selected_model`에 저장되며 기존 config key와 legacy `model` fallback을 보존한다.

### v4 스크린샷/문서 갱신 기준

실제 릴리스 스크린샷을 교체할 때는 다음 세 장면을 우선 캡처한다. 이 README는 이미 해당 제품 surface를 설명하며, binary release 전 이미지 asset 교체 여부만 확인하면 된다.

1. Settings > General: 언어, 테마, 튜토리얼 모드, provider model selector
2. Native menu: File > New/Open/Open Recent 및 Help > Tutorial
3. Project creation/onboarding: 폴더 선택 dialog 진입점

---

## 요구 사항

| 항목      | 버전      | 비고                                |
| --------- | --------- | ----------------------------------- |
| Node.js   | 22 이상   | Vite 7, ESLint 9 flat config        |
| pnpm      | 10 이상   | 유일하게 지원하는 패키지 매니저     |
| Rust      | 1.80 이상 | `rust-toolchain` 고정 없음 (stable) |
| Tauri CLI | 2.x       | `pnpm tauri`로 호출                 |

### Windows 빌드 추가 요구 사항

- Visual Studio 2022 Build Tools 이상
  - **C++ 데스크톱 개발** 워크로드
  - **ARM64 빌드 도구** 컴포넌트 (ARM64 NSIS 빌드 시 필수)
- `rustup target add x86_64-pc-windows-msvc`
- `rustup target add aarch64-pc-windows-msvc`
- WebView2 런타임 (Windows 11 기본 포함)

---

## 개발

```bash
pnpm install
pnpm tauri:dev      # 데스크톱 창 실행 (hot reload)
```

## 검증 (CI가 돌리는 모든 체크)

```bash
pnpm typecheck       # tsc --noEmit
pnpm lint            # ESLint 9
pnpm build           # Vite production build
pnpm verify:v4       # DIVE v4 productization Tracks A-G
pnpm format:check    # Prettier
pnpm format          # Prettier 자동 수정
```

Rust 쪽:

```bash
cd src-tauri
cargo fmt --all -- --check
cargo check --release
cargo test --features dev-mock --all-targets
cargo clippy --features dev-mock --all-targets -- -D warnings
```

## 빌드

### macOS / Linux (로컬 검증용)

상세 체크리스트는 [`../docs/dev-shell-verification.md`](../docs/dev-shell-verification.md)를 함께 확인하세요.

```bash
pnpm build           # Vite 번들만
pnpm tauri build     # 현재 OS 번들 (dmg / AppImage 등)
```

### Windows x64 NSIS 인스톨러

Windows 머신에서:

```bash
pnpm tauri:build:x64
# 산출물: src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*.exe
```

### Windows ARM64 NSIS 인스톨러

ARM64 Windows 머신 또는 크로스 빌드 환경에서:

```bash
pnpm tauri:build:arm64
# 산출물: src-tauri/target/aarch64-pc-windows-msvc/release/bundle/nsis/*.exe
```

> **주의 (명세 §11.3):** ARM64는 **NSIS 번들만** 가능 (MSI는 ARM64 미지원).

### 둘 다 한 번에

```bash
pnpm tauri:build:all
```

### CI (권장)

로컬 Windows 환경이 없을 때는 `.github/workflows/build.yml`이 GitHub Actions에서 Windows x64 (`windows-latest`) + ARM64 (`windows-11-arm`) NSIS 빌드를 수행한다. `main` push / PR / 수동 실행 시 NSIS 인스톨러가 artifact로 업로드된다.

---

## 디렉터리 구조 (명세 §11.6)

```
dive/
├── src-tauri/                Rust 백엔드
│   └── src/
│       ├── main.rs           엔트리포인트
│       ├── lib.rs            모듈 선언
│       ├── agent/            Agent Loop  (명세 §8)
│       ├── dive/             DIVE Gate Engine  (명세 §4)
│       ├── providers/        LlmProvider 어댑터들  (명세 §7)
│       ├── tools/            내장 도구  (명세 §6.3.1)
│       ├── mcp/              MCP 클라이언트  (명세 §6.3.2, §8.5)
│       ├── auth/             keyring 래퍼  (명세 §7.7, §9.5)
│       ├── checkpoint/       git2-rs 래퍼  (명세 §6.5)
│       ├── db/               rusqlite 래퍼  (명세 §10.2)
│       └── ipc/              Tauri commands  (명세 §11.5)
├── src/                      React 프론트엔드
│   ├── components/
│   │   ├── workmap/          워크맵 (하단 가로 띠)  (명세 §5.2)
│   │   ├── chat/             채팅 영역  (명세 §5.3)
│   │   ├── slide-in/         슬라이드 인 패널  (명세 §5.4)
│   │   ├── permission-card/  권한 카드  (명세 §5.5)
│   │   └── sidebar/          좌측 사이드바  (명세 §5.1.1)
│   ├── pages/
│   ├── hooks/
│   ├── stores/               Zustand
│   └── i18n/                 ko / en 리소스  (명세 §12.3)
├── package.json
├── tsconfig.json
├── eslint.config.js
├── .prettierrc.json
└── vite.config.ts
```

현재 Rust backend는 disk DB, provider runtime, native menu, checkpoints, event log, and IPC command surfaces를 포함한다. 개발 전용 demo route와 production product route는 Vite/Tauri 빌드에서 분리된다.

---

## 코드 서명 / SmartScreen

**현재 개발 빌드는 코드 서명되지 않는다.** Windows에서 설치할 때 SmartScreen이 "게시자를 알 수 없음" 경고를 띄우는 것은 정상이며, `추가 정보 → 실행`으로 진행할 수 있다.

v1.0 정식 배포를 위한 EV 코드 서명 인증서 도입은 **Phase 6 (2026-11~12)** 에서 다룬다 (명세 §11.3, 작업 6-4 / 6-5). 그 전까지는 개발자·파일럿 참가자에게 전달되는 바이너리에 서명이 없다는 점을 README·릴리스 노트에 명시한다.

---

## 트러블슈팅

| 증상                                               | 원인                                     | 해결                                                            |
| -------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------- |
| `LNK2019: unresolved external symbol` (ARM64 빌드) | VS "C++ ARM64 build tools" 컴포넌트 없음 | Visual Studio Installer에서 해당 컴포넌트 추가                  |
| `git2-rs` 빌드 실패 (의존성 추가 후)               | 시스템 libgit2 부재                      | `Cargo.toml`에 `features = ["vendored-libgit2"]`                |
| `openssl-sys` 빌드 실패                            | OpenSSL 헤더 부재                        | `rustls` 기반 대체 라이브러리 사용 (§A.3 권장)                  |
| `unknown variant perUser`                          | `tauri.conf.json` NSIS installMode 오타  | 허용값: `currentUser` / `perMachine` / `both`                   |
| `webkit2gtk` 관련 Linux 빌드 실패                  | 런타임 의존성 부재                       | `sudo apt-get install libwebkit2gtk-4.1-dev libsoup-3.0-dev` 등 |

---

## 라이선스

MIT (루트 `LICENSE` 참조).
