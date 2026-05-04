# Changelog

All notable changes to DIVE are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [SemVer](https://semver.org/lang/ko/).

## [Unreleased]

### External blockers before publish

- Full Windows physical-machine / CI `tauri-driver` + NSIS installed-app smoke.
- GitHub Release `v1.0.0-rc.1` UI yanked title/body update and `v1.0.0-rc.2` draft publish authority.
- Code signing remains v1.1+/production-distribution blocker.

## [1.0.0-rc.2] — 2026-05-04

### Added

- Production AppState production builder + disk DB + provider hydration + 4 call site 스냅샷 전환
- Cards persistence 레이어 (신규 `card_create` / `card_list` / `workmap_get` IPC + `useWorkmap` 훅)
- MainShell 전면 실 IPC 와이어링 + demo data 제거
- Silent localStorage fallback 제거 (`withTauriOrDemoMock` 리네이밍)
- URL namespace `?route=` (product) / `?demo=` (demo) 분리
- Onboarding Skip 재정의 (`onboarded = providers.length ≥ 1`)
- opencode zen provider 추가 (OpenAI-compatible route 재사용, 무료 모델 `gpt-5-nano` 기본)
- 빌트인 도구 4종 보강: `search_files` (안전) / `mkdir` (주의) / `delete_file` (위험) / `run_process` (위험)
- Bash sandbox 하드닝 (경로 분석 + 외부 쓰기 danger 승격)
- Checkpoint auto-trigger 전 단계 전환 (D→I / I→V / V reject / E entry) + `changed_files` 메타 + pre-restore 자동 백업
- EventLog emission 완전성 (8종 이벤트) + PII redaction
- V-stage 실 테스트 실행 경량 구현 (`test_command` + `run_process`)
- Release gate 2단계 (developer `pnpm tauri:dev` / release NSIS + tauri-driver 자동 스모크 + 수동 7종)
- rc.1 데이터 일회성 마이그레이션 모달 + localStorage cleanup

### Verification

- Developer production-wire gate: `node scripts/verify-production-wire.mjs`.
- rc.1 migration gate: `node scripts/verify-rc1-migration.mjs`.
- Release smoke preflight: `node scripts/release-gate-smoke.mjs --preflight`.
- Full frontend/Rust gate: typecheck, lint, build, fmt, `cargo test --all-targets`, clippy.

### Known external blockers

- `v1.0.0-rc.2` tag/publish waits for full Windows installed-app smoke and GitHub release authority.
- rc.1 GitHub Release UI yanked notice waits for release authority; assets must remain attached for archive purposes.

## [Yanked] 1.0.0-rc.1 — 2026-05-04

> **⚠️ 이 릴리스는 회수(Yanked)되었습니다.**

### 회수 사유

Production `AppState`가 `dev_mock()`에 와이어드되어 NSIS 빌드가 실 데이터 저장 / 실 LLM 호출 없이 데모만 구동되었습니다.

### 영향받는 파일

- `dive/src-tauri/src/lib.rs:29` — `let app_state = ipc::AppState::dev_mock();` (production 코드가 in-memory DB + 빈 MockProvider 사용)
- `dive/src/components/shell/MainShell.tsx` — `DEMO_CHANGED_FILES`, `simulateToolCallCount`, `setTimeout(450)` 가짜 verify
- `dive/src/stores/project-session.ts` — Tauri IPC 실패 시 localStorage로 silent fallback (실패 위장)
- workmap store ↔ DB cards 테이블 sync 레이어 부재 (카드 재시작 시 소실)

### 복구 방법

1. v1.0.0-rc.2 이상으로 업그레이드 (Phase 7 종료 후 릴리스 예정).
2. 기존 localStorage 데이터는 rc.2 첫 실행 시 자동 클리어 + 안내 모달 표시 ("rc.1 데이터 복구 불가, 새로 시작").
3. API 키 재입력 + 프로젝트 신규 생성 필요.

### GitHub Release 조치

- Release 제목: `[YANKED] DIVE v1.0.0-rc.1`
- Release 본문 상단에 ⚠️ 회수 공지 박스 추가
- `.exe` asset은 삭제하지 않음 (아카이브 목적)

### 참고

- 상세 분석 및 복구 계획: `DIVE_PLAN.md` §0 (진단) + §0-13 (rc.1 → rc.2 마이그레이션)
- 참조 ADR: ADR-052 (rc.1 yank 절차 + 마이그레이션)
- 협력 교사 공지 필수: 트랙 C 2회차 진입 전 이메일 또는 매뉴얼 섹션

### 원래 rc.1 산출물 (라벨만 유지, 실 동작은 rc.2부터)

- 다국어 (ko/en) · 접근성 단축키 · ARIA live region · WCAG AA 대비 검증 · motion-reduce · NSIS 메타데이터 · MIT License · 공개 README · GitHub Release 워크플로우 · v1.0.0-rc.1 태그

## [1.0.0-rc.1] — 2026-05-04 [SUPERSEDED BY YANKED SECTION ABOVE]

> 아래 섹션은 당시 기록을 위해 보존합니다. 최종 상태는 상단 `[Yanked]` 섹션을 따릅니다.

### Added

- **다국어 (ko/en)** — 커스텀 `t()` + Zustand persist · OS 언어 감지 · 사이드바 토글 (작업 6-1, ADR-033)
- **접근성 단축키** — `useGlobalShortcuts` 훅: Ctrl+N/S/E/W/,/ /+ 폼 필드 자동 억제 (작업 6-2, ADR-034)
- **ARIA live region** — 토스트 `role="region"` + `aria-live="polite"` (작업 6-2)
- **WCAG AA 대비 검증** — `verify-contrast.mjs` 런타임 WCAG 계산 (작업 6-3, ADR-035)
- **motion-reduce** — CardStateBadge 스핀 / Radix Dialog / Tooltip에 prefers-reduced-motion 대응 (작업 6-3)
- **NSIS 메타데이터** — category/publisher/copyright/descriptions + WebView2 downloadBootstrapper + `displayLanguageSelector: true` (작업 6-4, ADR-036)
- **MIT License** — `LICENSE` 파일, 리포지토리 루트 (작업 6-5)
- **공개 README** — 설치/기능/연구진/로드맵 요약 (작업 6-5)
- **GitHub Release 워크플로우** — 태그 `v*` 푸시 시 Windows x64/ARM64 아티팩트를 Release draft로 승격 (작업 6-5)

### Changed

- 버전 번호 동기화: `0.0.1` → `1.0.0-rc.1` (`package.json` · `Cargo.toml` · `tauri.conf.json`)
- Link 버튼 variant: `text-accent` → `text-accent-active` (라이트 모드 WCAG AA 충족)

### Fixed

- 라이트 모드 Link 버튼 색상 대비(3.7:1 → 3.4:1 + 밑줄) — UI 구성요소 AA 충족 + 의미 독립

## [0.3.0] — 2026-05-04 (Phase 5 종료)

### Added

- **Codex OAuth (PKCE)** — ChatGPT Plus/Pro 구독 어댑터 + Settings 다이얼로그 (작업 5-1, ADR-027)
- **MCP 클라이언트 기반** — JSON-RPC 2.0 + stdio/HTTP/Mock transport (작업 5-2, ADR-028)
- **MCP 도구 권한 카드** — `mcp__{server}__{tool}` 네임스페이스 + MAX(default, hint) 위험도 (작업 5-3, ADR-029)
- **프롬프트 도우미** — 단계별 템플릿 8개 + 한국어 모호함 감지 5 룰 (작업 5-4, ADR-030)
- **보내기 전 점검** — AI 자체 비평 + 토큰 사용량 즉시 표시 (작업 5-5, ADR-031)
- **v0.3 통합 테스트** — Codex + MCP 결합 end-to-end (작업 5-6, ADR-032)

### Metrics

- Rust: 238 tests / 0 failed / 1 ignored
- Playwright: 23 스위트 / 358 assertions

## [0.2.0] — 2026-04-18 (Phase 4 종료, 파일럿 직전)

### Added

- 온보딩 다이얼로그 + 프로젝트·세션 CRUD + Zustand persist (작업 4-1)
- 설정 화면 + 프로바이더 연결 UI + 익명화 export (작업 4-2)
- 네트워크 재시도 + 토스트 infrastructure (작업 4-3)
- UI 폴리싱 — 스켈레톤 / Restore confirm / Ctrl+S 토스트 (작업 4-4)
- 파일럿 체크리스트 + 벤치마크 템플릿 + Windows 빌드 가이드 + 25명 시뮬레이션 (작업 4-5)
- 학생 · 교사 매뉴얼 + 6 차시 시나리오 (작업 4-6)

## [0.2.0-beta] — 2026-03-22 (Phase 3 종료)

모든 게이트 강제 + 체크포인트 + 안전장치 완료. 차단 명령 블록리스트 · VerifyEngine · AiAssistEngine · 경로 제한 · 프로비저닝 키 UI.

## [0.1.0] — 2026-02-28 (Phase 2 종료)

v0.1 — 워크맵 + 채팅 + 권한 카드 + D 게이트. 메인 시나리오 A 가동.

## [0.0.1] — 2026-02-01 (Phase 1 종료)

기술 스파이크 완료. Tauri 2 + React 18 + TS 5 부트스트랩, LlmProvider trait + Anthropic/OpenAI 어댑터, SQLite 스키마, Windows x64/ARM64 빌드 검증.

---

[Unreleased]: https://github.com/coreelab/dive/compare/v1.0.0-rc.2...HEAD
[1.0.0-rc.2]: https://github.com/coreelab/dive/compare/v1.0.0-rc.1...v1.0.0-rc.2
[Yanked 1.0.0-rc.1]: https://github.com/coreelab/dive/releases/tag/v1.0.0-rc.1
[1.0.0-rc.1]: https://github.com/coreelab/dive/releases/tag/v1.0.0-rc.1
[0.3.0]: https://github.com/coreelab/dive/releases/tag/v0.3.0
[0.2.0]: https://github.com/coreelab/dive/releases/tag/v0.2.0
[0.2.0-beta]: https://github.com/coreelab/dive/releases/tag/v0.2.0-beta
[0.1.0]: https://github.com/coreelab/dive/releases/tag/v0.1.0
[0.0.1]: https://github.com/coreelab/dive/releases/tag/v0.0.1
