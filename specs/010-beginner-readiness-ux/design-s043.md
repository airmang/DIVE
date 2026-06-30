# S-043 Design — i18n Korean-parity sweep (Theme 3)

**Stage**: Wily `S-043` (dive-2, register via `design_stage` after S-042) · **Spec**: [spec.md](spec.md) Theme 3 · **Branch**: `010-beginner-readiness-ux`

**Evidence**: [round2-audit-findings.md](../../docs/qa/round2-audit-findings.md) P1-03, P1-06, P1-16, P1-20, P1-22, P1-28, P1-37, P2-01, P2-08, P2-11, P2-15, P2-18, P2-22, P2-24, P2-33, P2-38 (15/16 re-verified **still-live** by read-only workflow `wf_2c1674d7-cca`; P2-24 = the en/ko fallback-substitution finding, addressed by the parity assertion below). Headline must-confirm journey: the Korean roadmap English leak (P1-16/P1-28).

## Problem

A limited-English Korean novice runs DIVE in `ko` by default (`detectOsLocale`). The i18n fallback chain is **active → ko → key** (`i18n/index.ts:77`), so a *missing en* key shows Korean to an English user (P2-24), but the worse failure is **English values hardcoded in the `ko` resources** — the student sees raw English on the most load-bearing controls. Plus several backend-hardcoded strings and dev-jargon fallback copy leak through.

## Decision (constitution-aligned)

All Korean supervision UI must read as plain, beginner Korean (Constitution II); backend human-facing strings become machine codes localized in the frontend (Constitution VI typed seams); en/ko key-set parity is locked by a unit assertion. No new product surface — pure localization + one classifier + one parity test.

## Changes (grouped)

### A. Headline — Korean roadmap action surface (P1-16 ≡ P1-28)
Translate the **11 English values** in `ko.json` `plan_view`: `eyebrow` Project Plan→프로젝트 플랜, `done` Done→완료, `dependencies` needs→필요, `blocked_by` blocked by→막은 단계, `parallel_named` `Parallel · {{name}}`→`병렬 · {{name}}`, `run_group` `Run both ×{{count}}`→`병렬 실행 ×{{count}}` (count-neutral — also retires the "both"-for-3+ mislabel), `actions.{start,resume,open,locked,working}` Start/Resume/Open/Locked/Working...→시작/이어하기/열기/잠김/진행 중.... ko-only (en already correct).

### B. Pure-ko string leaks
- **P2-01** `runtime.selected_tooltip` / `runtime.capability.unavailable_tooltip` (ko): `Provider:/model:` → `제공자:/모델:`.
- **P2-08** `get_started.prd_action/prd_resume_action/prd_done_hint` (+`plan_desc`) (ko): jargon `PRD` → `요구사항` (matches existing `prd_title`=요구사항 초안 작성).

### C. ko+en copy (beginner Korean, drop jargon)
- **P2-11** `tool_call.blocked_explain`: drop `(§9.2)`; ko reassurance "이 명령은 위험해서 DIVE가 막았어요. 승인해도 실행되지 않습니다 — 안전을 위한 거예요."; en mirror.
- **P1-22** gloss "Diff" in plain Korean on the verify stepper/coach strings (`stepper_code_files`, `bundle_diff_*`, `coach_unavailable*`) — reuse the already-glossed "변경 코드"; first-use "변경 코드(diff: 빨강=지운 줄, 초록=추가한 줄)".
- **P2-15** `coach_fallback.{responsive,accessibility}` + `coach_unavailable_reason.*`: rewrite to observable-outcome Korean (no `375px`/`ARIA`/`Tab`/`Pi sidecar`/`런타임`).
- **P2-18** `recovery.explain_error/adjust_plan`: soften residual dev phrasing to beginner outcomes (light).

### D. Hardcoded component labels → i18n
- **P1-03 ≡ P2-22** `CodexOAuthDialog.tsx`: hardcoded `code`/`state` field labels → new `codex_oauth.code_label` (ko "인증 코드", en "Verification code") + `codex_oauth.state_label` (ko "보안 검증 값", en "Security check value"); route the raw error (`:250`) through `classifyError`.
- **P1-37** `PreviewTab.tsx` preview reason codes → new `slide_in.preview.reason.{unsupported_extension,project_escape,unsupported_url}` (beginner ko + en), rendered by code instead of raw enum slug.

### E. Backend hardcoded strings → machine codes (Rust)
- **P1-20** `supervisor.rs`: evidence labels `"Diff 확인"`→`"변경 내용 확인"` (:303) and `"Test result"`→`"테스트 결과"` (:348); add reverse `localized_evidence_label` en mappings (변경 내용 확인→"Diff reviewed", 테스트 결과→"Test result"). Check/adjust any test asserting the old labels.
- **P2-38** `preview.rs`: hardcoded Korean reuse strings (:682, :1044) → machine codes (`reused_running_server`/`reused_started_server`); localize in `PreviewTab.tsx` via `slide_in.preview.reused_*` (ko + en).

### F. Error classifier + boundary
- **P1-06** `error-classify.ts`: add `project_create` classification (unsafe_path / permission / canonicalize) → `error.project_create.*` (beginner ko + en); `NewProjectDialog.tsx:65` shows the classified message, not the raw Rust string.
- **P2-33** `main.tsx` `StartupErrorBoundary`: hardcoded Korean-only → bilingual via `startup.error.title/description` (the boundary is outside the React tree's locale store, so resolve via `translate(detectOsLocale(), …)`).

### G. Parity lock (P2-24 + Theme-3 deliverable)
Add a Vitest `i18n/parity.test.ts` deep-comparing `ko.json`/`en.json` key sets — fails on any key present in one locale but not the other. This catches the silent ko-for-missing-en substitution (P2-24) and locks every key added above.

## Test strategy

- **Vitest**: en/ko deep key-set parity (G); `classifyProjectCreateError` unit (P1-06); `plan_view` ko values are non-Latin / render Korean (P1-16/P1-28); CodexOAuthDialog labels render i18n (P1-03/P2-22); preview reason codes render localized (P1-37).
- **Rust** (`--features dev-mock`): supervisor evidence-label round-trip (ko label + en `localized_evidence_label`) (P1-20); preview reuse emits machine codes, not Korean prose (P2-38). `cargo fmt`/`clippy -D warnings`.
- **Live re-QA (ko + en)**: the must-confirm journey — after plan approval, the roadmap rail shows **시작/이어하기/열기/잠김/완료/병렬 실행** in Korean (no Start/Resume/Open/Locked/Done/needs/blocked by). Spot-check Codex OAuth labels, a blocked-command card (no §9.2), and a project-create error (plain Korean).

## Out of scope

WCAG contrast (P1-27 etc.) → S-044; vocabulary/onboarding primers → S-045. P1-29 "Run both ×N" pluralization is folded into the P1-16/P1-28 `run_group` retranslation (count-neutral wording), not separately expanded.

**Deferred to a follow-up (P2-38)**: `preview.rs` hardcoded-Korean reuse strings live in the `logs` vector (dev-facing panel), and the user-facing `message` field on that path is already English, not Korean — fully localizing it requires a `PreviewResult` message/logs machine-code contract change broader than this i18n sweep. Tracked as a small follow-up; the 15 higher-impact Theme-3 findings (all P1s + the headline roadmap leak + the parity lock) land here.
