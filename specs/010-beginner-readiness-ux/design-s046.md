# S-046 Design — Error/recovery legibility, loading states & composer gating (Theme 6)

**Stage**: Wily `S-046` (dive-2, register via `design_stage` after S-045) · **Spec**: [spec.md](spec.md) Theme 6 · **Branch**: `010-beginner-readiness-ux`

**Evidence**: [round2-audit-findings.md](../../docs/qa/round2-audit-findings.md) P1-01, P1-05, P1-23, P1-36, P2-02, P2-17, P2-19, P2-20, P2-32, P2-39, P2-40. Two pairs collapse to one change each: **P1-23 ≡ P2-39** (same `recovery.restore_confirm_body`) and **P1-05 ≡ P2-20** (same onboarding error rendering).

## Problem

At the highest-stress beginner moments — a dead runtime, a bad key, a broken step, a restore decision — DIVE shows false, scary, or missing status. The composer stays fully enabled when the supervised runtime is `unavailable`, so a novice fires instructions into a dead runtime (P1-01). Connect failures dump a raw English provider tail and silently drop the classified recovery hints, and unknown errors show a bare raw string (P1-05, P2-20). The live restore confirm speaks of "the backend" mutating files without saying the restore is itself undoable (P1-23, P2-39). Async loads render as false-empty states: the sidebar says "No projects yet" mid-load (P1-36) and the recovery panel says "no checkpoints" while still fetching (P2-40). Recovery is discoverable only via a passive top-bar badge, with nothing near the failed artifact (P2-19); the composer never says Enter sends (P2-02); the coach observation form is a dead-end when a step has no criteria (P2-32); and the quickstart promises a green-dot timeline the product doesn't have (P2-17).

## Decision (constitution-aligned)

All fixes are honest status/copy on the real artifact — grounded in concrete runtime/checkpoint/failure state (Constitution II), no generic banners, quizzes, or theater (I/V). Reuse the existing `inputBlocked` banner, `Skeleton`, classified-error, and `onOpenRecovery` seams; no new mechanic. Frontend/CSS + one docs edit; no Rust.

## Changes (grouped)

### A. Composer gating on dead runtime (P1-01)
`useProductShellController.ts` (~:2000): when `runtimeSelection.state === 'unavailable'`, produce an `inputBlocked` from the **existing concrete state** — `reason = runtimeSelection.message`, `actionLabel`/`onAction` resolved from `runtimeSelection.setupAction` (`configure_provider`/`add_credentials` → open settings; `open_project` → empty-state action; `retry_runtime` → retry) — instead of leaving `deriveInputBlocked` blind to it. Reuses the shipped `ChatArea.tsx:409` non-blocking banner + action button (not a generic warning). New i18n `runtime.setup_action.{configure_provider,add_credentials,open_project,retry_runtime}` action labels if not present.

### B. Onboarding error: hints + suppressed raw tail (P1-05 ≡ P2-20)
`OnboardingDialog.tsx`: replace the flat `onboardingErrorMessage` (which renders only `bodyKey` with its `원문: {{message}}` tail) with a structured error `{ headline, hints[], raw }`: `headline = kind==='unknown' ? t('onboarding.connect_failed_generic') : t(titleKey)`; `hints = t(hintsKey).split('|')` rendered as plain-Korean bullets; `raw = rawMessage` inside a collapsed `<details>` (`onboarding.details` = 자세히). Surface the existing **API key link** in the error state. This suppresses the raw English tail from the primary message (P1-05), gives the `unknown` bucket a plain wrapper + guidance + link (P2-20), and renders the previously-dropped hints. Fix the shared `error.auth/rate_limit.hints` `Settings` → `설정` (localized) leak.

### C. Restore confirm — plain + reversible (P1-23 ≡ P2-39)
Reword `recovery.restore_confirm_body` (both locales), dropping `백엔드`/`the backend` and stating the concrete effect + that the restore is itself undoable (grounded in the real auto-pre-restore checkpoint, `checkpoint/mod.rs:285`): ko "DIVE가 프로젝트 파일을 {{checkpoint}} 시점으로 되돌려요. 되돌리기 전에 지금 상태를 먼저 '복원 직전' 지점으로 저장하니, 이 되돌리기도 다시 되돌릴 수 있어요." / en mirror.

### D. Loading vs false-empty (P1-36, P2-40)
- **Sidebar.tsx** (P1-36): while `!loaded`, render `Skeleton` rows for the project (and session) lists instead of `sidebar.empty_projects`/`select_project_first`; show the empty copy only once `loaded`.
- **RecoveryPanel.tsx** (P2-40): when `loading && checkpoints.length === 0`, render a `recovery.loading` ("복구 지점을 불러오는 중…") state in the last-change card + list region instead of `recovery.no_checkpoints`.

### E. Contextual recovery near the failed artifact (P2-19)
`ToolActivity.tsx`: in the failed-tool row (`result && !result.success`), add a small inline **"복구 열기"** button calling the already-threaded `provocation.onOpenRecovery` (new `tool_call.failed_recovery_hint`). One contextual, evidence-grounded affordance next to the concrete failure — not an auto-opened modal or generic banner.

### F. Composer Enter hint (P2-02)
`ChatInput.tsx`: a muted hint line under the textarea, `chat.input.enter_hint` = "Enter로 전송 · Shift+Enter로 줄바꿈" / "Enter to send · Shift+Enter for a new line". Static affordance label.

### G. Coach dead-end when no criteria (P2-32)
`VerificationCoachPanel.tsx`: when `criteria.length === 0`, suppress the observation textarea + Record button (which can never fire) and show an honest line (`coach_no_criteria_hint`) explaining this step has no checkable criterion so a free observation isn't required — point to the diff/preview check instead. Removes the impossible action + misleading "add a criterion" hint.

### H. Quickstart ↔ product reconcile (P2-17)
`docs/student-quickstart.md`: replace the "green-dot timeline" recovery description with the actual live affordance — the TopBar **복구** button opening the checkpoint list — in the same plain wording (lower-risk option (a); no product theater).

## Test strategy
- **Vitest**: `deriveInputBlocked`/controller runtime-unavailable gate returns a block with the concrete reason (P1-01); `OnboardingDialog` renders classified hints + collapses raw + no `원문:` tail in the primary message, and the unknown bucket shows the plain generic headline (P1-05/P2-20); `Sidebar` renders skeletons while `!loaded` and empty copy once loaded (P1-36); `RecoveryPanel` shows the loading state while fetching + the reworded restore body has no `백엔드` (P2-40, P1-23/P2-39); `ChatInput` shows the Enter hint (P2-02); `VerificationCoachPanel` suppresses the record form when no criteria (P2-32); `ToolActivity` shows the recovery button on a failed result (P2-19). en/ko parity via `parity.test.ts`.
- **Frontend CI**: `format:check`/`typecheck`/`lint`/`test:unit`. No Rust surface.
- **Live re-QA (ko)**: block the composer by an unavailable runtime and confirm the banner + setup action; open Recovery mid-fetch (loading, not false-empty) and read the reworded restore confirm; see the Enter hint under the composer; a failed tool shows the inline 복구 열기.

## Out of scope / preserve
- No auto-opening modals, generic banners, quizzes, or theater (I/V); recovery surfacing stays a single evidence-grounded affordance. Preserve S-041–S-045 behavior; the raw error text remains available as collapsed evidence (Constitution II). P2-18 (recovery jargon labels) is a separate finding not in Theme 6's set.
