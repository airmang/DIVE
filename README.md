# DIVE

> 초심자를 위한 로컬 AI 코딩 에이전트 데스크톱 앱

**DIVE**는 코딩 에이전트를 터미널에서 직접 다루기 어려운 초심자가 데스크톱 UI 안에서 목표를 설명하고, 계획을 검토하고, 단계별 실행·변경 사항·검증 증거·되돌리기를 확인할 수 있도록 만든 **Windows 데스크톱 앱**입니다.

[![build](https://github.com/airmang/DIVE-2/actions/workflows/build.yml/badge.svg)](https://github.com/airmang/DIVE-2/actions/workflows/build.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![platform](https://img.shields.io/badge/platform-Windows%20x64%20%7C%20ARM64-0078d4.svg)](#설치)

---

## 현재 버전

**1.0.0-rc.2** — production AppState, disk DB, provider runtime, roadmap persistence, Settings, native menu, and productization checks are active.

> ⚠️ `v1.0.0-rc.1`은 회수(Yanked)되었습니다. 해당 빌드는 production AppState가 demo mock으로 와이어드되어 실제 데이터 저장/실 LLM 호출이 동작하지 않습니다. **v1.0.0-rc.2 이상**만 사용하세요.

---

## 제품 흐름

DIVE의 제품 UI는 일반 사용자가 이해하기 쉬운 용어를 우선합니다.

1. **프로젝트 열기** — 작업할 로컬 폴더를 선택합니다.
2. **AI 연결** — DIVE가 사용할 AI 도우미를 연결합니다.
3. **목표 입력** — 만들고 싶은 기능이나 수정하고 싶은 문제를 자연어로 설명합니다.
4. **계획 검토** — AI가 제안한 계획과 범위를 확인합니다.
5. **로드맵** — 작업을 작은 단계로 보고 현재 위치를 파악합니다.
6. **단계별 실행** — 에이전트가 한 단계씩 작업하고 필요한 도구 권한을 요청합니다.
7. **변경 사항 확인** — 패치와 영향을 확인합니다.
8. **검증 실행** — 테스트/명령 결과를 확인합니다.
9. **되돌리기** — 체크포인트로 안전하게 복구합니다.

내부적으로는 기존 상태 모델과 안전 게이트를 보존하지만, 일반 제품 화면에서는 계획, 로드맵, 단계, 변경 사항, 검증, 되돌리기 같은 제품 용어를 사용합니다.

---

## 핵심 기능

- **초심자용 데스크톱 UI** — 터미널 중심 흐름 대신 채팅, 계획, 로드맵, 변경 확인으로 진행
- **AI 코딩 과정 가시화** — 의도, 계획, 변경 사항, 검증 증거를 한 흐름에서 확인
- **검증 증거 구분** — AI 자가보고와 실제 실행·미리보기·테스트 증거를 분리해 표시
- **AI 연결** — Anthropic · OpenAI · OpenRouter · ChatGPT OAuth · Custom OpenAI-compatible
- **권한 요청** — 도구 실행 전 위험도와 변경 미리보기를 확인하고 승인/거부
- **검토와 되돌리기** — 멈추고, 확인하고, 체크포인트가 있을 때 이전 상태로 복구
- **프롬프트 도우미** — 모호한 요청을 더 구체적인 작업 지시로 다듬기
- **다국어** — 한국어 · 영어
- **접근성** — 키보드 동작, 스크린리더 알림, 대비 검증
- **로컬 우선 안전장치** — 프로젝트 폴더 밖 쓰기 제한, 위험 명령 차단, 텔레메트리 없음

---

## 설치 (Windows)

**Windows 10 22H2 이상** 또는 **Windows 11** 필요.

### 1. 다운로드

[GitHub Releases](https://github.com/airmang/DIVE-2/releases/latest) 페이지에서 본인 PC 아키텍처에 맞는 인스톨러를 받으세요:

- **x64 (일반 인텔·AMD)**: `DIVE_<version>_x64-setup.exe`
- **ARM64 (Surface Pro X / Copilot+ PC)**: `DIVE_<version>_arm64-setup.exe`

### 2. 실행

1. 다운로드한 `.exe`를 더블클릭
2. **SmartScreen 경고 — "추가 정보" → "실행"**
   - v1.0 시점에는 EV 코드 서명 미적용이라 정상 동작입니다
   - 코드 서명은 Azure Trusted Signing 도입 검토 중 (`docs/packaging-windows.md` §4)
3. NSIS 설치 마법사 → 기본값 그대로 → 완료

설치 경로: `%LOCALAPPDATA%\Programs\DIVE\` (사용자 프로필, 관리자 권한 불필요)

### 3. 첫 실행

- OS 언어가 한국어면 한국어 UI, 아니면 영어로 시작합니다. Settings > General에서 전환할 수 있습니다.
- 온보딩에서 프로젝트 폴더를 선택하고 AI 도우미를 연결합니다.
- 이후 채팅에 목표를 적고 계획/로드맵/권한/변경 사항을 확인하며 진행합니다.

사용자 가이드: [튜토리얼](./docs/user-guide/tutorial.md) · [FAQ](./docs/user-guide/faq.md) · [트러블슈팅](./docs/user-guide/troubleshooting.md)

---

## Product UX Refactor QA checklist

Phase 8 release screenshots and smoke notes should show the beginner product path, not internal research tooling:

- Choose a local project folder.
- Connect an AI assistant from Settings / AI Connection.
- Describe a goal in natural language.
- Answer the short Deep Interview questions.
- Review and approve the plan.
- Follow the Roadmap and run one step at a time.
- Review permissions, changed files, checks, and Recovery & Undo.

Internal research, diagnostics, classroom, teacher/student, and D/I/V/E state-machine material belongs in `docs/internal/` or dev-only routes, not product screenshots or the first-run user path.

---

## 개발자 섹션

상세 빌드 가이드는 [`dive/README.md`](./dive/README.md) · [`docs/packaging-windows.md`](./docs/packaging-windows.md)를 참조하세요.

```bash
# 요구사항: Node 22.19+, pnpm 10+, Rust 1.80+
cd dive
pnpm install
pnpm tauri:dev        # 개발 모드 (hot reload)
pnpm tauri:build:x64  # Windows x64 NSIS
```

### 검증 체크

```bash
cd dive
pnpm typecheck
pnpm lint
pnpm build
pnpm verify:v4

cd src-tauri
cargo test --features dev-mock --all-targets
cargo clippy --features dev-mock --all-targets -- -D warnings
```

---

## 설계 원칙

- **사용자는 제품 UI에서 조종** — 로컬 도구와 명령은 백엔드가 실행하되, 사용자는 계획·권한·변경·검증으로 이해합니다.
- **작은 단계** — 큰 목표를 안전하게 실행 가능한 단계로 나눕니다.
- **가역성** — 체크포인트와 복구 흐름을 기본으로 둡니다.
- **투명성** — 도구 호출, 에러, 변경 파일, 검증 결과를 숨기지 않습니다.
- **로컬 우선** — 프로젝트 데이터와 비밀값은 로컬 저장소/OS keyring 중심으로 관리합니다.

내부 운영 문서: [`docs/internal/`](./docs/internal/) · ADR ledger: [`DIVE_DECISIONS.md`](./DIVE_DECISIONS.md) (72 ADR, latest ADR-085)

---

## 로드맵

| 버전        | 범위                                                                                |
| ----------- | ----------------------------------------------------------------------------------- |
| v1.0.0-rc.2 | Production wiring · disk DB · provider runtime · roadmap persistence · release gate |
| Phase 8     | Product UX Refactor — beginner-friendly desktop coding agent surface                |
| v1.0        | Product UX polish · accessibility · release hardening                               |

---

## 라이선스

[MIT License](./LICENSE)

---

## 기여·문의

- 이슈·PR: [GitHub Issues](https://github.com/airmang/DIVE-2/issues)
- 보안 취약점 제보: 별도 이슈 대신 관리자에게 직접 연락
