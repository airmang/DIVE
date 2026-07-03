# Changelog

All notable changes to DIVE are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [SemVer](https://semver.org/lang/ko/).

## [Unreleased]

_대기 중인 미출시 변경 사항 없음._

## [1.0.0-rc.6] — 2026-07-02

Round-2 beginner-readiness & UX hardening (spec 010, Wily Stages S-041–S-049): an audit of 78 findings across a 14-dimension beginner rubric, plus two owner-added themes — a mandatory student architecture decision in the PRD interview, and supervised agent web access under a new constitution-governed network-egress capability class.

### Added

- **Supervised agent web access (S-048, 010 theme 8).** A single DIVE-owned, model-visible `web_fetch` tool lets the agent read live docs/API/reference pages during a build. Egress originates in Rust and crosses validate → permission → guard → bounds → logging before any byte leaves the machine: the first SSRF-validated egress path, with a resolved-IP denylist (RFC1918/loopback/link-local/CGNAT/TEST-NET/cloud-metadata, incl. IPv6-embedded IPv4 for mapped/6to4/Teredo/NAT64), DNS-rebind pinning to the exact validated IP, a manual per-hop redirect re-validation loop (`redirect::Policy::none()`), 3 MiB on-the-wire / 5 s connect / 25 s total-deadline bounds with decompression disabled, GET-only and https-only. `RiskLevel::Danger` with a web-specific beginner approval card (host + resolved IP as the trust anchor; the model-authored purpose is labeled unverified), Build-run-mode-only exposure with a permission backstop, a sibling offline/timeout/blocked status chip, and query-string-dropped / hashed-path EventLog export. Web content is agent input, never verification evidence.
- **Mandatory PRD architecture decision (S-047, 010 theme 7).** The PRD interview now requires a student-owned `ArchitectureDecision` (bounded application form + free-text stack) via a two-stage recommend-then-confirm flow (the AI proposes, the student decides), gating PRD confirmation and grounding decomposition. Decomposition additionally receives per-form scaffolding guidance, and a deterministic, non-blocking form/step-consistency annotation is recorded to the research ledger (S-049).
- **Beginner vocabulary, first-run framing & a Safe/Warn/Danger permission primer (S-045, 010 theme 5)**, with primer exposure/dismissal now auditable in the local EventLog (S-049).

### Changed

- **Anti-automation-bias hardening (S-042, 010 theme 2):** offline verify-provocation routing, a high-risk read gate, and review-card honesty.
- **Korean-parity i18n sweep (S-043, 010 theme 3)** including a deep ko/en key-parity test, plus a machine-code contract for preview reuse log lines (S-049).
- **WCAG AA contrast + semantic a11y (S-044, 010 theme 4):** a deterministic contrast test over the design tokens, with the light `--color-info` token darkened to clear info badges at AA (S-049).
- **Error/recovery legibility, loading states & composer gating (S-046, 010 theme 6).**
- **PRD interview honesty & the PRD→plan confirmable gate (S-041, 010 theme 1).**

### Governance

- **Constitution 1.0.0 → 1.1.0 (MINOR).** Principle III gains a tightly-scoped, default-deny **Rust-validated network-egress capability class** (ADR `specs/010-beginner-readiness-ux/adr-s048-network-egress.md`), governing `web_fetch` and binding pre-existing process-tool egress to the same safe-egress policy (tracked follow-up).

### Fixed

- **Restored green CI.** `pi_sidecar::long_pi_turn_with_heartbeats_is_bounded_by_turn_timeout` used a 250 ms turn timeout too tight for loaded CI runners (process spawn + first heartbeat could exceed it, so no heartbeat was observed before the bound fired). Raised to 2 s — still well under the test's 5 s bound and far below the 60 s heartbeat-stall timeout, so the turn stays bounded by turn timeout while heartbeats are reliably observed.

### Verification

- Full local CI green: Rust `cargo fmt --check` + `cargo clippy --all-targets --features dev-mock -D warnings` + `cargo test --all-targets --features dev-mock`; frontend `pnpm format:check` + `pnpm typecheck` + `pnpm lint` + `pnpm test:unit`. S-048's 14 security acceptance criteria are each covered by a passing test, and a 3-lens worktree-isolated adversarial review (SSRF / agency / log-hygiene) returned no SSRF or redaction findings. Live re-QA of the S-048/S-049 surfaces on a rebuilt release app is the remaining follow-up for this build.

## [1.0.0-rc.5] — 2026-06-25

E2E quality hardening — the supervised verify loop now demands real, per-criterion observation, and the in-app preview can actually exercise the behavior under test (spec 009 themes 2 & 3).

### Changed

- **Evidence gate is per-criterion and action-backed (S-029, 009 theme 2).** The decision gate clears only when EVERY acceptance criterion carries an observation backed by a real open/click/test action — typing free text or clicking through no longer satisfies it (specs 002/003 FR-030~033: click ≠ evidence). Criteria come from the step's linked criteria, or an enumerated single-string criterion is split into its parts; the gate surfaces an "N of M criteria observed" blocking reason and binds each "I observed" confirmation to one specific criterion.
- **In-app preview can exercise the behavior under test (S-031, 009 theme 3).** The preview iframe sandbox now allows modals and forms (`confirm()` / `alert()` / `<form>` submit), a responsive width toolbar (mobile 375 / tablet 768 / desktop) makes breakpoints observable, a reload button forces a real reload, Escape no longer closes the panel while the preview is focused, and any project page can be opened through the loopback static server (which serves non-index pages and same-origin data).

### Fixed

- **Restored green CI.** Two verification-coach credential tests asserted `MissingCredentials` but used a bare `dev_mock()` (OS keyring), which errors on the headless CI runner and masked the reason as `RuntimeUnavailable`. They now inject the host-independent `InMemoryKeyring`, unblocking the release gate / Windows build jobs.

### Verification

- Frontend `pnpm typecheck` + `pnpm lint --max-warnings 0` + `pnpm format:check` + `pnpm test:unit`; Rust `cargo fmt --check` + `cargo clippy --all-targets --features dev-mock -D warnings` + `cargo test --features dev-mock --all-targets`. Live `.app` re-QA of the affected journeys (STATIC-05 / DEBUG-03 / ADDFEATURE-01 / STYLED-02 / DATA-01) is the remaining follow-up for this build.

## [1.0.0-rc.4] — 2026-06-24

First MVP build of the Sarkar "AI as provocateur" supervision layer working end to end.

### Fixed

- **P1 verify card never rendered.** The SupervisorAgent prompt named the decision schema by name but never listed the required keys, so every model returned a wrong-shaped JSON (`passed`/`confidence`/`rationale` instead of `provoke`/`concern`/`severity`) and the backend dropped it as `parse_error` — 100% of the time, across gpt-5.4-mini and claude-sonnet-4.6. The prompt now spells out the exact key set, injects the per-event concern, and includes a worked example; `parse_supervisor_decision` also tolerates a fenced/prose-wrapped object. The shared prompt is used by all six review-card event families, so this repairs the whole supervisor card surface, not just the verify card (#24).
- **Supervisor questions occasionally dropped as `not_question`.** The prompt now requires the question to end with `?`, which the deterministic `is_question` check accepts unambiguously (#24).

### Added

- **Bounded retry on recoverable supervisor drops** (`provocation_agent_evaluate`, up to 3 attempts, env `DIVE_SUPERVISOR_EVALUATION_ATTEMPTS`) plus a supervisor turn timeout raised 8s → 12s, lifting the realized card show-rate from ~80–90% to ~95–99%. Retries only fire on recoverable drops (malformed/off-contract output or transient infra), never on provider-unavailable, a genuine `provoke=false`, or dedup (#24).

### Changed

- **Review cards are now pure provocations.** Only action buttons that actually open the artifact (diff/preview/run) or a recovery path are shown. The "revise the request/plan" and "ask the AI to do X" nudges (`split_scope`, `edit_prd`, `link_criterion`, `add_verification_step`, …) are no longer rendered as buttons — they only seeded a prompt or focused a field, which read as a broken affordance. Those capabilities remain available via each screen's dedicated controls (#25).

## [1.0.0-rc.3] — 2026-06-22

이 릴리스는 rc.2 이후 누적된 plan-first 워크플로(v0.3), v4 생산화, Phase 10 하드닝을 함께 출시했습니다.

### Added

- Phase 9 / v0.3 plan-first workspace flow:
  - End-to-end plan-first path: project entry → Socratic interview → plan draft + mermaid approval → Roadmap (Step DAG) → per-step execution. v0.2's bottom workmap strip is absorbed into the right Roadmap panel.
  - SQLite v7 migration adds four entities — `Interview`, `Plan`, `Step`, `StepSessionMapping` — plus indexes; the existing `Card` / `Workmap` / `Session` / `Message` / `Checkpoint` / `EventLog` tables are unchanged (ADR-081).
  - At plan approval time, portable artifacts are exported under `.dive/plan.json`, `.dive/plan.md`, and `.dive/flow.mmd`; SQLite remains the runtime source of truth and wins on conflict (ADR-080).
  - Tauri IPC commands for the Plan/Interview lifecycle: `workspace_plan_status`, `workspace_plan_start_interview`, `workspace_plan_save_interview_answer`, `workspace_plan_submit_interview`, `workspace_plan_generate_draft`, `workspace_plan_approve`, `workspace_plan_discard_plan`, `workspace_plan_list_steps`, `workspace_plan_step_mappings`.
  - Tauri IPC commands for Step DAG operations: `roadmap_step_open`, `roadmap_step_update_state`.
  - 3-pane product shell grid (sidebar · chat · Roadmap right panel) with new components: `SocraticInterviewPanel`, `PlanDraftApprovalScreen`, `MermaidDiagram`, `RoadmapGraph`. `PlanDraftInlineActions` is removed in favor of the dedicated approval screen.
  - Frontend hooks: `usePlan`, `usePlanInterviewLLM`, `usePlanRoadmap` derive Step status (planned / blocked / ready / in_progress / review / done / shipped) from `Step` rows merged with `StepSessionMapping` rows.
  - `chat_send` accepts `step_id`, `run_mode` (Interview / Plan / Build), and `plan_accepted`; `RunModePermissionHook` gates mutating tools so only `run_mode = Build` with an approved plan and a valid step can mutate (ADR-083).
  - `Step` ↔ `Card` is an optional 1:1 mapping via `StepSessionMapping`; opening a ready step creates the mapping and seeds the implementation session (ADR-082).
  - ADRs added: ADR-080 (SQLite as runtime SoT, `.dive/*` as approval-time export), ADR-081 (Card unchanged, plan metadata in new `Step` table), ADR-082 (`Step` ↔ `Card` optional 1:1 via `StepSessionMapping`), ADR-083 (Interview → Plan → Step → Card 4-layer split with run_mode gates).
  - `mermaid` ^11.12.1 added to `dive/package.json` for plan flow diagram preview.
  - 2026-05-10 close-out verification on local: `cargo fmt --check`, `cargo clippy --all-targets --features dev-mock -D warnings`, `cargo test --features dev-mock --all-targets` (all 0 failed), `pnpm typecheck`, `pnpm lint --max-warnings 0`, `pnpm build` — all clean. See `docs/internal/DIVE_NEXT.md` for evidence.
- DIVE v4 productization polish: native project/menu entry points, Tauri folder picker, tutorial mode, provider model selector, and per-track verification scripts.
- Static provider model lists and persisted `selected_model` storage for connected providers.
- `pnpm verify:v4` aggregate gate covering Tracks A-G; Track H live model refresh remains a follow-up.
- Productization blocker closure from `dive-snazzy-lighthouse.md`: release gates green, beginner reasoning/retrospective flow, research ablation settings, and anonymized retrospective analysis tooling.
- Phase 10 release hardening: MCP product UI hidden for v1 with guarded IPC inputs, provider custom endpoints restricted to HTTPS or localhost development URLs, project create/delete path policy hardened, and rollback documentation added.

### Changed

- Provider onboarding and Settings copy now use product-oriented tone.
- Language and theme controls moved into Settings > General; sidebar duplicate controls removed.
- Demo pages remain available in development but are excluded from production bundles with DEV-only lazy imports.
- Default chat model hint copy is generic and no longer embeds concrete model IDs.
- Bundle descriptions now use product language without the internal D/I/V/E research framing, and the production chat surface no longer shows dead disabled controls.
- GitHub Release publishing is now release-owner-approved `workflow_dispatch` only; `release-gate.yml` requires `release_owner` evidence and uploads the smoke-tested x64/ARM64 NSIS artifacts, while `release.yml` requires a release owner plus a numeric `release-gate.yml` run id, validates the same-commit release-gate run and its x64/ARM64 smoke JSON evidence, creates the draft tag at the workflow commit SHA, and publishes the tested installers with `DIVE-release-evidence`.

### Fixed

- Recent project ordering now remains deterministic when multiple updates occur in the same millisecond.
- Release gate red lights cleared for `verify:production-wire`, `verify:version-sync`, and `format:check`.
- Phase 10 Gate A rerun is green: frontend typecheck/lint/build/format/production-wire/v4 plus Rust fmt/check/test/clippy and the corrected release mock guard path.
- Windows AI calls no longer open a visible terminal window for the Pi sidecar process.
- Verification review "Request changes" now sends the required revision note instead of failing with `note required when outcome is not 'approved'`.

### Verification

- `pnpm typecheck`
- `pnpm vitest run src/components/product/StepDetailSlideIn.test.tsx`
- `cargo check --lib --quiet`
- `cargo test --features dev-mock --test card_state_machine revision_requested_requires_note_and_rejects_card --quiet`

### External blockers before publish

- Full Windows physical-machine / CI `tauri-driver` + NSIS installed-app smoke.
- GitHub Release `v1.0.0-rc.1` UI yanked title/body update and `v1.0.0-rc.2` draft publish authority.
- Code signing remains v1.1+/production-distribution blocker.
- Windows installers are currently unsigned. SmartScreen may show an unknown-publisher warning; trusted internal testers should use **More info → Run anyway**. Azure Trusted Signing remains a v1.1+ follow-up.
- Phase 10 release publication remains blocked on Windows x64/ARM64 physical smoke and GitHub Release authority; rollback links must remain in release notes.

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
- Windows installers are unsigned for this candidate, so SmartScreen unknown-publisher warnings are expected. Use `More info → Run anyway` only for trusted internal builds.

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

- 상세 분석 및 복구 계획: `docs/archive/legacy-specs/DIVE_PLAN.md` §0 (진단) + §0-13 (rc.1 → rc.2 마이그레이션)
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

[Unreleased]: https://github.com/airmang/DIVE-2/compare/v1.0.0-rc.4...HEAD
[1.0.0-rc.4]: https://github.com/airmang/DIVE-2/compare/v1.0.0-rc.3...v1.0.0-rc.4
[1.0.0-rc.3]: https://github.com/airmang/DIVE-2/compare/v1.0.0-rc.2...v1.0.0-rc.3
[1.0.0-rc.2]: https://github.com/airmang/DIVE-2/compare/v1.0.0-rc.1...v1.0.0-rc.2
[Yanked 1.0.0-rc.1]: https://github.com/airmang/DIVE-2/releases/tag/v1.0.0-rc.1
[1.0.0-rc.1]: https://github.com/airmang/DIVE-2/releases/tag/v1.0.0-rc.1
[0.3.0]: https://github.com/airmang/DIVE-2/releases/tag/v0.3.0
[0.2.0]: https://github.com/airmang/DIVE-2/releases/tag/v0.2.0
[0.2.0-beta]: https://github.com/airmang/DIVE-2/releases/tag/v0.2.0-beta
[0.1.0]: https://github.com/airmang/DIVE-2/releases/tag/v0.1.0
[0.0.1]: https://github.com/airmang/DIVE-2/releases/tag/v0.0.1
