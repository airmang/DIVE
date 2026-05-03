# DIVE

AI 코딩 교육용 데스크톱 앱. Tauri 2.x + React 18 + TypeScript 5 + Vite.

명세: 리포지토리 루트의 [`DIVE_SPEC.md`](../DIVE_SPEC.md).

현재 버전 **0.0.1** — Phase 1 부트스트랩. 빈 창 + §11.6 디렉터리 골격만 존재하며, 도메인 로직·디자인 토큰은 다음 작업부터 채워진다.

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
pnpm format:check    # Prettier
pnpm format          # Prettier 자동 수정
```

Rust 쪽:

```bash
cd src-tauri
cargo fmt --all -- --check
cargo check --all-targets
```

## 빌드

### macOS / Linux (로컬 검증용)

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

Phase 1 부트스트랩 시점의 Rust 서브모듈들은 모두 `//!` 모듈 docstring만 담은 placeholder이며, 어느 작업에서 실제 구현되는지 각 `mod.rs`에 표시되어 있다. `lib.rs`의 `#![allow(dead_code)]`는 placeholder 모듈이 채워질 때까지 임시로 유지된다.

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

미정 (명세 §14.1, Phase 6에서 확정).
