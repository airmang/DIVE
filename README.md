# DIVE

> 초심자가 AI 코딩 에이전트를 **감독**하며 배우는 로컬 데스크톱 앱

**DIVE**는 코딩 에이전트를 터미널에서 직접 다루기 어려운 초심자를 위한 **데스크톱 앱**(Windows · macOS)입니다. 목표를 자연어로 설명하면 AI가 계획을 세우고 코드를 바꾸지만, 사용자는 그 과정을 **계획 검토 → 단계별 실행 → 변경 확인 → 검증 → 되돌리기**로 지켜보고 통제합니다. DIVE의 핵심은 "AI가 대신 코딩해 주는 것"이 아니라 **AI를 감독하는 법을 익히게 하는 것**입니다.

[![build](https://github.com/airmang/DIVE/actions/workflows/build.yml/badge.svg)](https://github.com/airmang/DIVE/actions/workflows/build.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![platform](https://img.shields.io/badge/platform-Windows%20x64%20%7C%20ARM64%20%7C%20macOS%20arm64-0078d4.svg)](#설치)
[![version](https://img.shields.io/badge/version-1.0.0--rc.9-6f42c1.svg)](./CHANGELOG.md)

---

## 왜 다른가

일반적인 AI 코딩 도구는 사용자가 결과를 그대로 받아들이도록 유도합니다. DIVE는 반대로 설계됐습니다.

- **AI 자가보고 ≠ 검증 증거** — "AI가 다 됐다고 함"과 실제 테스트·실행·미리보기로 확인한 것을 화면에서 분리해 보여 줍니다.
- **근거 있는 개입** — 목표·계획·권한·변경·터미널 오류·검증 게이트처럼 실제 프로젝트 상태에 근거가 있을 때만 검토 카드가 뜹니다. 근거 없는 일반 경고는 띄우지 않습니다.
- **감독을 연습시키는 흐름** — 계획을 나누고, 지시하고, 실행하고, 검증하고, 확장하는(Decompose · Instruct · Execute · Verify · Extend) 실제 작업 안에서 감독 역량을 기릅니다. 퀴즈·배지·별도 학습 트랙이 아닙니다.

이 방향의 논거는 별도의 내부 연구 노트(공개 저장소 미포함)에 정리되어 있습니다.

---

## 제품 흐름

1. **프로젝트 열기** — 작업할 로컬 폴더를 선택합니다.
2. **AI 연결** — DIVE가 사용할 AI 도우미를 연결합니다 (Anthropic · OpenAI · OpenRouter · ChatGPT OAuth · Custom OpenAI 호환).
3. **목표 입력 & PRD 인터뷰** — 만들 기능을 자연어로 설명하고, 짧은 인터뷰로 요구사항과 완료 기준을 함께 정리합니다.
4. **계획 검토** — AI가 제안한 계획·범위·아키텍처 결정을 확인하고 승인합니다.
5. **로드맵** — 작업을 작은 단계로 보고 현재 위치를 파악합니다.
6. **단계별 실행** — 에이전트가 한 단계씩 작업하며 필요한 도구 권한을 위험도와 함께 요청합니다.
7. **변경 확인** — 패치와 영향을 미리 봅니다.
8. **검증 실행** — 테스트·명령·미리보기 결과를 실제 증거로 확인합니다.
9. **되돌리기** — 체크포인트로 안전하게 복구합니다.

내부적으로는 상태 모델과 안전 게이트를 보존하되, 제품 화면에서는 계획·로드맵·단계·변경·검증·되돌리기 같은 초심자 친화 용어를 씁니다.

---

## 핵심 기능

- **초심자용 데스크톱 UI** — 터미널 대신 채팅·계획·로드맵·변경 확인으로 진행
- **검증 증거 구분** — AI 자가보고와 실제 실행·미리보기·테스트 증거를 분리해 표시
- **검토 카드(확인 필요 카드)** — 관련 아티팩트 옆에서 근거와 함께 짧은 확인 액션 제공
- **두 가지 감독 모드** — Work(저마찰) / Guided(더 많은 설명), 둘 다 실제 프로젝트에서 동작
- **권한 요청** — 도구 실행 전 위험도와 변경 미리보기를 확인하고 승인/거부
- **감독형 웹 접근** — DIVE 소유 `web_fetch` 도구로만 나가는 네트워크. Rust에서 SSRF·리다이렉트·크기/시간 한도를 검증하고 기본 차단·프로젝트별 옵트인 (헌법 III, ADR S-048)
- **검토와 되돌리기** — 멈추고, 확인하고, 체크포인트로 이전 상태 복구
- **프롬프트 도우미** — 모호한 요청을 더 구체적인 작업 지시로 다듬기
- **로컬 우선 로깅** — 워크플로·감독·검증 이벤트를 로컬 EventLog로 기록하고 익명화 export (연구 분석용)
- **다국어 · 접근성** — 한국어·영어, 키보드 동작, 스크린리더 알림, WCAG AA 대비
- **로컬 우선 안전장치** — 프로젝트 폴더 밖 쓰기 제한, 위험 명령 차단, 텔레메트리 없음

---

## 설치 (Windows)

**Windows 10 22H2 이상** 또는 **Windows 11** 필요.

### 1. 다운로드

[GitHub Releases](https://github.com/airmang/DIVE/releases/latest)에서 PC 아키텍처에 맞는 인스톨러를 받으세요:

- **x64 (일반 인텔·AMD)**: `DIVE_<version>_x64-setup.exe`
- **ARM64 (Surface Pro X / Copilot+ PC)**: `DIVE_<version>_arm64-setup.exe`

### 2. 실행

1. 다운로드한 `.exe`를 더블클릭
2. **SmartScreen 경고 → "추가 정보" → "실행"** (v1.0 시점 EV 코드 서명 미적용이라 정상. [`docs/packaging-windows.md`](./docs/packaging-windows.md) §4)
3. NSIS 설치 마법사 → 기본값 → 완료

설치 경로: `%LOCALAPPDATA%\Programs\DIVE\` (관리자 권한 불필요)

### 3. 첫 실행

- OS 언어가 한국어면 한국어 UI로, 아니면 영어로 시작합니다 (Settings > General에서 전환).
- 온보딩에서 프로젝트 폴더를 선택하고 AI 도우미를 연결한 뒤, 채팅에 목표를 적고 계획·로드맵·권한·변경을 확인하며 진행합니다.

사용자 가이드: [튜토리얼](./docs/user-guide/tutorial.md) · [FAQ](./docs/user-guide/faq.md) · [트러블슈팅](./docs/user-guide/troubleshooting.md) · [학생용 빠른 시작](./docs/student-quickstart.md)

---

## 개발

전체 빌드/패키징은 [`dive/README.md`](./dive/README.md) · [`docs/packaging-windows.md`](./docs/packaging-windows.md) 참조.

```bash
# 요구사항: Node 22.19+, pnpm 10+, Rust 1.80+
cd dive
pnpm install
pnpm tauri:dev          # 개발 모드 (hot reload)
pnpm tauri:build:x64    # Windows x64 NSIS
pnpm tauri:build:arm64  # Windows ARM64 NSIS
```

### 검증 체크 (푸시 전)

```bash
# 프론트엔드
cd dive
pnpm format:check && pnpm typecheck && pnpm lint && pnpm build

# Rust
cd src-tauri
cargo fmt --all -- --check
cargo clippy --features dev-mock --all-targets -- -D warnings
cargo test --features dev-mock --all-targets
```

배포 대상은 Windows(x64·ARM64) NSIS 인스톨러와 macOS(Apple Silicon) `.app`(zip)/`.dmg`입니다. macOS 빌드는 현재 **미서명**이라(Windows 인스톨러와 동일) 첫 실행 시 Gatekeeper가 "확인되지 않은 개발자" 경고를 띄웁니다 — 앱을 우클릭 → **열기**로 한 번 실행하면 이후에는 정상 실행됩니다. Linux에서는 로컬 개발·QA용 번들만 지원합니다. Pi 사이드카는 Node SEA로 빌드되어 아키텍처별 호스트에서 컴파일해야 하므로 릴리스는 CI 매트릭스(`.github/workflows/build.yml`)를 사용합니다.

---

## 설계 원칙

DIVE v2의 [헌법](./.specify/memory/constitution.md)이 정하는 원칙:

- **실제 프로젝트 워크플로만** — 모든 화면은 사용자의 실제 작업(계획·지시·실행·검증·확장) 안에서 동작. 퀴즈·플래시카드·배지 앱이 되지 않음.
- **개입 전에 증거** — 경고·검토 카드·승인 프롬프트는 구체적 프로젝트 상태에 근거해야 함. AI 자가보고를 검증으로 취급하지 않음.
- **Pi 런타임이 유일한 런타임** — 에이전트 실행은 Pi가 담당하되, 모든 파일·프로세스·네트워크 행동은 Rust 소유 검증·권한·가드·로깅·체크포인트를 통과.
- **로컬 우선 연구 원장** — 상태·이벤트·증거를 로컬 EventLog로 감사 가능하게 보존하고 익명화 export. 비밀값은 로그에 남기지 않음.
- **저마찰 가이드 감독** — Work 모드는 가볍게, 마찰은 고위험·모호·미검증 상태에만.
- **타입 있는 경계와 결정적 테스트** — 도메인 모델·계약을 명시하고, 트리거·중복제거·로깅 같은 결정적 로직은 단위 테스트로 커버.

---

## 문서 지도

| 위치                                                                              | 내용                                                                                  |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [`README.md`](./README.md) · [`dive/README.md`](./dive/README.md)                 | 제품/개발 진입점                                                                      |
| [`CHANGELOG.md`](./CHANGELOG.md)                                                  | 릴리스 히스토리                                                                       |
| [`.specify/memory/constitution.md`](./.specify/memory/constitution.md)            | v2 헌법 (최상위 권위)                                                                 |
| [`specs/`](./specs/) · [`specs/README.md`](./specs/README.md)                     | 캐논 스펙 (001–010)                                                                   |
| [`docs/spec-status.md`](./docs/spec-status.md)                                    | 스펙 권위 상태 원장                                                                   |
| [`DIVE_DECISIONS.md`](./DIVE_DECISIONS.md)                                        | ADR 원장 (72 ADR, 최신 ADR-085)                                                       |
| [`docs/user-guide/`](./docs/user-guide/) · [`docs/scenarios/`](./docs/scenarios/) | 사용자·수업 문서                                                                      |
| [`docs/research/`](./docs/research/)                                              | 참고문헌 목록만 공개 — KACE2026 연구 산출물 본문은 내부 연구 노트(공개 저장소 미포함) |
| [`docs/archive/`](./docs/archive/)                                                | 이관된 과거 설계·계획 (참고용, 비활성)                                                |

---

## 연구 배경

DIVE는 제품인 동시에 **연구 도구**입니다. "AI 시대의 프로그래밍 교육은 *작성*에서 *감독*으로 옮겨가야 한다"는 논지를 검증하기 위해, 감독 개입과 증거를 로컬에서 재구성 가능하게 로깅합니다. 관련 산출물은 2026 한국컴퓨터교육학회(KACE2026) 발표를 목표로 준비 중이며, 별도의 내부 연구 노트(공개 저장소 미포함)에 정리되어 있습니다. DIVE가 감독 역량·비판적 사고를 향상시킨다는 주장은 경험적 데이터로 뒷받침되기 전까지 **가설**로 다룹니다.

---

## 로드맵

| 버전        | 범위                                                                                                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| v1.0.0-rc.9 | 학회 데모 준비 3라운드 (011): 계획 품질 게이트 정직화(P0-01), 광고된 모델의 실행 가능성 보장(P0-02), 가짜 정지 타임아웃 제거, PRD 인터뷰 정직·복구, 학생 편집의 AI-요약 오귀속 제거, 릴리스 게이트 복구 — macOS 무각본 라이브 데모 GO 확정 |
| v1.0.0-rc.8 | PRD 아키텍처 추천 보드 반영 (S-047 2단계 인터뷰 완성): AI의 폼/스택 추천이 채팅 프로즈가 아닌 선택 가능한 카드로 보드에 반영                                                                                                               |
| v1.0.0-rc.7 | 라이브 프로바이더 모델 카탈로그 + Claude Sonnet 5: OpenRouter `/models` 라이브 조회로 신규 상위 모델이 코드 변경 없이 자동 노출                                                                                                            |
| v1.0.0-rc.6 | 라운드2 초심자-readiness/UX 하드닝 (010, S-041–S-049): PRD 인터뷰 정직성, 자동화-편향 방지, 한국어 i18n 패리티, WCAG AA, 초심자 어휘·첫 실행, 오류·복구 가독성, 필수 아키텍처 결정, 감독형 `web_fetch`                                     |
| v1.0.0-rc.5 | 009 E2E 품질 하드닝 (50 여정 갭 분석)                                                                                                                                                                                                      |
| v1.0.0-rc.4 | 1차 MVP 릴리스 (Windows x64·ARM64)                                                                                                                                                                                                         |
| v1.0.0-rc.3 | 검증 수정요청 처리, 숨은 Pi 사이드카                                                                                                                                                                                                       |
| v1.0.0-rc.2 | Production wiring · disk DB · provider runtime · roadmap persistence · release gate                                                                                                                                                        |

> ⚠️ `v1.0.0-rc.1`은 **회수(Yanked)**되었습니다 — 해당 빌드는 production AppState가 demo mock으로 연결돼 실 저장·실 LLM 호출이 동작하지 않습니다. **v1.0.0-rc.2 이상**을 사용하세요.

전체 변경 이력은 [`CHANGELOG.md`](./CHANGELOG.md) 참조.

---

## 라이선스 · 기여

- [MIT License](./LICENSE)
- 서드파티 고지는 [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md) 참조
- 이슈·PR: [GitHub Issues](https://github.com/airmang/DIVE/issues)
- 보안 취약점 제보: 이슈 대신 관리자에게 직접 연락
