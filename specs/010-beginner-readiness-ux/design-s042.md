# S-042 Design — Anti-automation-bias hardening (core pedagogy)

**Stage**: Wily `S-042` (dive-2, to register via `design_stage` after S-041) · **Spec**: [spec.md](spec.md) Theme 2 · **Branch**: `010-beginner-readiness-ux`

**Evidence**: [round2-audit-findings.md](../../docs/qa/round2-audit-findings.md) P1-14, P1-15, P1-17, P1-18, P1-21, P1-25, P1-26, P2-09, P2-13, P2-14, P2-30 (all re-verified **still-live** against HEAD by read-only workflow `wf_c5b928ec-e9e`, 2026-06-30). The keystone (P1-21) is the product's core teaching moment — *"AI said done ≠ verified."*

## Problem (one pedagogy, many leaks)

DIVE's reason to exist is to inoculate a novice against **automation bias** — reflexively trusting/approving what the AI did. Eleven gaps let the novice rubber-stamp or never meet the lesson:

| # | Leak | Surface |
| --- | --- | --- |
| **P1-21** | The verify-provocation card silently **DROPS offline / no-provider** — exactly when a beginner most needs "AI done ≠ verified". The deterministic question already exists but is unreachable in production. | `provocation_agent.rs`, `supervisor.rs` |
| P1-17 | Danger-tier `delete_file` / `run_process` / `run_terminal_script` have **zero approval friction** (no diff ⇒ Approve enabled at render) — one-click rubber-stamp of the most destructive actions. | `ToolActivity.tsx`, `DangerCard.tsx` |
| P1-18 | Plan-vs-actual **file divergence** ("AI went off-script") is hidden in a collapsed `<details>`; the strongest calibrated-suspicion signal is buried. | `PermissionSummary.tsx` |
| P1-25 | The **secret-write callout** lives only inside `DiffViewer`; when there's no diff it vanishes — the highest-stakes approval loses its only danger signal. | `DiffViewer.tsx`, `PatchPreviewPanel.tsx` |
| P1-26 | The read-gate copy tells the student to "open or scroll the diff" **when no diff is on screen** — a content-free acknowledgement. | `ToolActivity.tsx`, i18n |
| P1-14 | The plan-critique gate is a single asymmetric click; **"없음 — 승인 가능"** unblocks with zero engagement. | `PlanDraftApprovalScreen.tsx` |
| P1-15 | The critique response is **never logged** — the research ledger cannot tell a blind-approve from an engaged one (Constitution IV). | `PlanDraftApprovalScreen.tsx`→`useProductShellController.ts`→`usePlan.ts`→`workspace_plan.rs` |
| P2-09 | The critique gate (the step's only anti-bias trigger) has **no test coverage** (Constitution VI). | `PlanDraftApprovalScreen.test.tsx` |
| P2-13 | The `trust_calibration_hint` ("AI가 틀렸을 수 있는 지점은?") is authored but **never rendered**. | `ProvocationCard.tsx` |
| P2-14 | **Dismissing** a review card marks the "Review response" stepper stage as *evidenced* — making the card vanish == "I reviewed it" (click ≠ evidence). | `StepDetailSlideIn.tsx`, `ProvocationCardHost.tsx` |
| P2-30 | "Mark irrelevant" is an icon-only **GREEN CHECKMARK** on a caution card — a beginner reads it as "approve / this is fine". | `ProvocationCard.tsx` |

## Decision (constitution-aligned, minimal, evidence-grounded)

Every fix surfaces or hardens an **existing, evidence-grounded** signal. No quizzes/badges/decks/static-fallback/generic banners (Constitution I/II/V). Friction is added only at genuine high-risk/unverified points (V). Deterministic seams get unit tests (VI).

### A. Keystone — never lose the verify provocation offline (P1-21)
`p1_provoke_gate` (VerifyEntered + `ai_self_report` + `!concrete_evidence`) is already deterministic, and `build_stage_c_supervisor_decision` already produces the criterion-linked, bilingual "AI 완료 보고 ≠ 직접 확인" question with proper concern/evidence/actions. But `supervisor_output_from_runtime` returns `RuntimeUnavailable` on any runtime/provider failure → `evaluate_with_output_and_log` **drops** it; the `DomainShell → build_stage_c` branch (already wired for AiClaimedDone/VerifyEntered) is **unreachable in production**.

**Fix (pure wiring, typed seam):** add `fn runtime_unavailable_output(event) -> StageCSupervisorOutput` returning `DomainShell` for `AiClaimedDone | VerifyEntered`, else `RuntimeUnavailable`. In `supervisor_output_from_runtime`, after the context is built (we are already past the `supervisor_provoke_gate` check at :216, so the provoke gate is true), replace the runtime/provider-unavailable returns (provider/descriptor/config/cwd missing; `RuntimeUnavailable`/`CredentialUnavailable`/`SidecarUnavailable` errors) with `return runtime_unavailable_output(context.event);`. The deterministic card then routes through the existing `DomainShell + AiClaimedDone/VerifyEntered → build_stage_c_supervisor_decision` path, validated/deduped/cooled like any card.

- **Scope:** only the **unavailability** returns. `Timeout` / `SidecarError` stay drops (runtime was reached; they're transient/recoverable and already retried). The pre-context `normalize_source_ui_mode` error stays `RuntimeUnavailable`. `build_supervisor_prompt` `Err` stays `Drop` (malformed context, not unavailability).
- **No test churn:** the existing `evaluate_with_output_and_log(RuntimeUnavailable)` drop test is unchanged (that function's `RuntimeUnavailable` arm is untouched). The change is which *output* `supervisor_output_from_runtime` emits offline.

### B. Proportionate friction on the riskiest unverified actions (P1-17)
Extend `requiresReadGate` in `ToolActivity.tsx` to also fire for a **no-diff Danger** tool (`delete_file`, `run_process`, `run_terminal_script`; `risk === "danger"` && no diff && not already write/secret-gated). `DangerCard` already implements the checkbox-only `needsReadConfirm` fallback — reuse it; Approve stays blocked until the student ticks "변경/실행 내용을 확인했습니다". Reuses existing UI; no quiz. (`bash` from the audit text is not a registry tool id; the three `registry.rs` Danger ids are the real set.)

### C. Surface buried calibrated-suspicion evidence
- **P1-18** divergence: in `PermissionSummary.tsx`, compute `unexpectedWriteFiles = writeFiles \ expectedFiles` (only when `expectedFiles` non-empty); when non-empty render a short visible line on the card body — *"계획에 없던 파일을 바꾸려 합니다: {paths} · 의도한 변경인지 확인하세요."* Suppressed when files match (sparse, no banner without divergence).
- **P1-25** secret callout: hoist the `secretFlagged` + `wholeFileOverwrite` callouts so they also render from `PatchPreviewPanel`'s missing-diff branch (keep them in `DiffViewer` for the with-diff case). Grounded in backend `approvalWarnings.secretReasons` — surfacing them everywhere they apply *satisfies* II. Share the `secretReasonLabel` helper.
- **P1-26** read-gate copy: make `approvalRequirement.message` conditional on diff presence — keep the "review the change above" copy when a diff/callout is shown; switch to `read_gate.message_no_diff` ("미리보기가 없습니다 — 아래 파일 경로와 변경 내용(diff)을 확인한 뒤 허용하세요") when none. Gloss "diff" in Korean.

### D. Make plan-critique honest and auditable (P1-14, P1-15, P2-09)
- **P1-14 friction artifact:** when `tutorialEnabled` and `critique === "none"`, reveal one short inline note input *"이 계획으로 충분하다고 본 이유를 한 줄로 적어주세요"* anchored to the on-screen plan; Approve unblocks only when the note is non-trivial (trimmed length ≥ 4). Light, artifact-anchored, plan-approval gate only — not every step. "있음 — 변경 요청" keeps the existing request-changes route.
- **P1-15 + provenance unification:** model the resolution as `{ response: "none" | "found", note?: string }` and thread it onApprove → `useProductShellController.handleApproveGeneratedPlan` → `usePlan.approvePlan(planId, critiqueResolution)` → `workspace_plan_approve` IPC → `append_plan_activity("plan_approved", …, reason = Some(json))` with `{ "critique_response", "critique_note" }` (bounded). The note is the **student's own** supervision sentence — a research signal, not AI self-report and not a secret (IV).
- **P2-09 tests:** with `tutorialEnabled: true` assert Approve disabled at first render (critique unset), disabled after "있음", disabled on "없음" until the note is authored, enabled once authored, and that onApprove fires with the resolution.

### E. Exercise calibrated doubt + fix dishonest signals on the review card
- **P2-13** render `trust_calibration_hint` as a one-line muted contextual line on the **`ai_self_report_only`** card body (the verify-provocation card) near the focal question — sparse (only this card type), dismissible with the card. Complements the keystone: offline, the deterministic card now also carries "어디서 AI가 틀렸을 수 있을까?".
- **P2-14** distinguish *engaged* from *dismissed*: track `engagedProvocationCardIds` (set on a look-at-artifact action — `open_diff`/`open_preview`/`run_tests`/`run_app` — or a recorded one-line observation) and key `reviewCardsEvidenced` off engagement, not mere `handled`. Dismiss/mark-irrelevant still clears the card and logs the response (IV) but leaves the stepper stage neutral. Dismiss is never blocked (II).
- **P2-30** replace the green `CheckCircle2` mark-irrelevant glyph with a neutral non-success icon (`EyeOff`, `text-fg-muted`) and add a `title` tooltip mirroring the existing aria-label so sighted novices don't read it as "approve".

## Changes (by file)

- `dive/src-tauri/src/ipc/provocation_agent.rs` — `runtime_unavailable_output` seam + reroute the unavailable returns (P1-21); unit tests.
- `dive/src-tauri/src/ipc/workspace_plan.rs` — `workspace_plan_approve` accepts `critiqueResolution`; `plan_approved` event carries critique provenance (P1-15); test.
- `dive/src/components/chat/ToolActivity.tsx` — no-diff Danger read gate (P1-17); diff-conditional read-gate message (P1-26).
- `dive/src/components/permission-card/{DangerCard,PermissionSummary,DiffViewer,PatchPreviewPanel}.tsx` — checkbox label for danger actions (P1-17); divergence line (P1-18); hoisted secret/whole-file callouts (P1-25).
- `dive/src/components/product/PlanDraftApprovalScreen.tsx` (+ `.test.tsx`) — critique note artifact + threaded resolution (P1-14/P1-15); gate tests (P2-09).
- `dive/src/components/product/useProductShellController.ts`, `dive/src/features/planning/usePlan.ts` — thread critique resolution to the approve IPC (P1-15).
- `dive/src/features/provocation/ProvocationCard.tsx` — trust-calibration hint (P2-13); neutral mark-irrelevant glyph + tooltip (P2-30).
- `dive/src/components/product/StepDetailSlideIn.tsx`, `dive/src/features/provocation/ProvocationCardHost.tsx` — engaged-vs-dismissed stepper evidence (P2-14).
- `dive/src/i18n/{ko,en}.json` — `read_gate.message_no_diff`, `summary.divergence_*`, danger confirm label, critique note placeholder, mark-irrelevant label/tooltip. **en/ko key parity preserved.**

## Test strategy

- **Rust** (`--features dev-mock`): `runtime_unavailable_output` returns `DomainShell` for AiClaimedDone/VerifyEntered, `RuntimeUnavailable` otherwise; existing DomainShell+verify→shown coverage confirms the routing; `workspace_plan_approve` writes critique provenance into the `plan_approved` event. `cargo fmt` / `clippy -D warnings`.
- **Frontend (Vitest):** read-gate fires + Approve blocked until checkbox for no-diff `delete_file`/`run_process`/`run_terminal_script` (P1-17); divergence line shows only on mismatch (P1-18); secret callout renders with null diff (P1-25); read-gate message swaps on diff presence (P1-26); critique-note gate (P1-14/P2-09); critique resolution reaches `approvePlan` (P1-15); trust hint only on `ai_self_report_only` (P2-13); dismiss leaves stage neutral, engagement marks it evidenced (P2-14); mark-irrelevant glyph is non-success + has tooltip (P2-30); en/ko parity assertion.
- **Live re-QA (ko + en)** — the must-confirm journey: connect no provider (or stop sidecar), enter Verify with changed files → the deterministic "AI 완료 보고 ≠ 직접 확인" card appears (not a coach error / silent drop), carries the trust hint, and blocks rubber-stamp. Plus spot-check a Danger delete card (checkbox gate) and a no-diff secret write (callout). Record in `round2-live-qa-run-log.md`.

## Out of scope (other stages)

i18n parity sweep beyond the few keys added here → S-043 (Theme 3); WCAG contrast on the diff viewer/links (P1-27) → S-044; Safe/Warn/Danger onboarding primer & quickstart honesty (P1-19, P2-10) → S-045; review-card "why it appeared" inline prose (P2-12) and supervisor pending-state (P2-31) → later themes. S-042 touches only the anti-automation-bias hardening set above.
