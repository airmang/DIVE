# S-041 Design — PRD interview honesty & criterion scaffolding + PRD→plan gate reconciliation (expanded)

**Stage**: Wily `S-041` (`STG-d3bf195e7bec`, dive-2) · **Spec**: [spec.md](spec.md) Theme 1 (expanded 2026-06-30 to fold in the owner-found plan-confirm loop) · **Branch**: `010-beginner-readiness-ux`

**Evidence**: [round2-audit-findings.md](../../docs/qa/round2-audit-findings.md) P1-09/10/12/13/30; [round2-live-qa-run-log.md](../../docs/qa/round2-live-qa-run-log.md) (live-confirmed PRD dead-end + adversarially-verified plan-confirm loop root cause, workflow `w546u6lhd`).

## Problem (one root cause, two symptoms)

Upstream "ready"/admission signals **under-promise** relative to stricter downstream confirm gates:

| Tier | Bar | Where |
| --- | --- | --- |
| A — PRD interview "ready" | goal + ≥1 non-empty criterion | `prd_interview_next_focus`, `is_confirmable_project_spec_draft` (=`is_minimal_project_spec_draft`), `workspace_plan.rs:1757-1767,2099-2114` |
| A' — PRD confirm button (user-facing) | non-vague goal + intent≥8 + ≥1 scope + ≥1 non-goal + **2 substantive criteria** | `validateConfirmableProjectSpec` `projectSpec.ts:372-407`, `canConfirmPrd` `PrdAuthoringBoard.tsx:236` |
| B — plan-generation admission | goal + ≥1 criterion | `is_minimal_project_spec` `workspace_plan.rs:2744-2750` |
| C — **plan-confirm content gate** | per-criterion observable markers **+ state-class coverage keyed off goal keywords** (UI⇒Responsive+Persistence+Accessibility; data-fetch⇒Loading+Empty+Error) | `validate_criterion_quality` `workspace_plan.rs:2752,4480-4559`; `criterion_class_is_covered`, `ui_goal_keywords`/`data_fetch_keywords` `dive/src-tauri/src/dive/plan_quality_constants.rs:358-374` |

- **Symptom 1 (P1-09/P1-10 — PRD dead-end):** Tier A fires "ready_to_save" (AI says "확정 버튼 누르세요") before Tier A' is met → button disabled, footer demands more, interview already stopped asking. Live-confirmed.
- **Symptom 2 (plan-confirm loop):** Tier A'/B admit a PRD that Tier C rejects whenever the model-generated plan misses a required state-class. On failure the UI shows `PlanDraftRecoveryScreen` (Retry + Close only); **Retry resends the unchanged `interview.goal`** via `compact_retry_prompt` (`en/ko.json:958`) passing only the failure enum slug — never the missing classes — so every retry reproduces the identical deterministic rejection (`useProductShellController.ts:1840-1849`). Inescapable for a beginner.

## Decision (constitution-aligned)

**Do NOT push state-class authoring onto the novice** (forcing a beginner to write "accessibility"/"loading-state" acceptance criteria is exactly the jargon/wizard burden Constitution I/V and the round-2 rubric forbid). Instead:

1. **Align Tier A with Tier A' (PRD interview honesty).** `prd_interview_next_focus` / `is_confirmable_project_spec_draft` must reflect the *same* bar the user-facing confirm gate enforces (non-vague goal + intent + ≥1 scope + ≥1 non-goal + ≥2 substantive criteria), so the AI only says "ready to confirm" when `canConfirmPrd` is actually true; otherwise it asks **one plain-language question for the next genuinely-missing field**. (Fixes P1-09/P1-10.) Keep the single-question, no-jargon, no-checklist interview contract.

2. **Make the plan-draft retry make progress (break the loop).** When `validate_criterion_quality` fails with `MissingStateCriteria`/`VagueCriteria`, the failure already carries the actionable missing items (`planDraftFailure.unresolvedQuestions` / the recovery `missingItems`). Feed those **specific missing classes into the retry prompt** so the model regenerates a plan whose criteria cover them — the **model authors** the state-class criteria (proposes; the student still reviews them at plan approval, Constitution II). Each retry now changes inputs → no identical-rejection loop.

3. **Give the recovery screen a real escape.** `PlanDraftRecoveryScreen` adds a clear, plain-Korean route **back to PRD authoring** (with the missing classes named) in addition to Retry/Close, so a student who prefers to thicken the PRD by hand is not blocked behind the recovery panel.

4. **Light upstream nudge (secondary, optional within budget).** If the goal hits `ui_goal_keywords`/`data_fetch_keywords`, the PRD interview *may* ask one observable-done-state question that naturally elicits a persistence/empty/error behavior in plain language ("새로고침해도 남아 있어야 하나요?", "할 일이 하나도 없을 때 화면은 어떻게 보일까요?") — never the jargon class names, never a required checklist. This reduces how often retry-enrichment is needed without adding ceremony.

This puts state-class criteria authoring on the AI (review-gated), keeps the PRD interview beginner-light, and guarantees the PRD→plan boundary can always make forward progress.

## Changes

- **`workspace_plan.rs`** — reconcile `is_confirmable_project_spec_draft` / `prd_interview_next_focus` (Tier A) with the confirm-gate fields (intent, ≥1 scope, ≥1 non-goal, ≥2 substantive criteria); emit a concrete next-field question instead of early `ready_to_save`. (Keep `validate_criterion_quality` strictness; only the *signal* changes.) Mirror minimal vs confirmable for the non-draft `ProjectSpec` path as needed.
- **`projectSpec.ts`** — single source of truth for the confirmable bar; ensure the backend signal and this validator agree (shared thresholds / a documented contract). Add the explicit **Add-criterion** affordance support if the gate needs a manual path (P1-30).
- **`PrdAuthoringBoard.tsx`** — Add-criterion button + trailing empty row (P1-30); voice missing fields conversationally is interview-driven (backend), but the board's footer wording aligns; factual reply on patch-only turns (P1-12); fix DIVE prose↔button label ("PRD 확정").
- **`useProductShellController.ts:1840-1849` + `en/ko.json:958`** — `handleRetryPlanDraft` passes the missing criterion classes (`planDraftFailure.unresolvedQuestions`) into `compact_retry_prompt`; the prompt instructs the model to add criteria covering exactly those classes.
- **`PlanDraftRecoveryScreen.tsx`** — add a "PRD로 돌아가 기준 보강" action that routes to PRD authoring with missing classes surfaced; keep Retry (now progress-making) + Close.

## Test strategy

- **Rust unit/integration** (`workspace_plan.rs` tests, `--features dev-mock`): readiness signal now matches the confirmable bar (table-driven: minimal vs confirmable drafts → expected `prd_interview_next_focus`); `validate_criterion_quality` unchanged behavior preserved; a thin-PRD→plan retry path that, given missing-class feedback, can produce a passing plan (deterministic given a stub plan input covering the classes).
- **Frontend unit** (Vitest): `handleRetryPlanDraft` includes missing classes in the prompt args; recovery screen renders the back-to-PRD action; QuickIntake routed through `validateConfirmableProjectSpec`; en/ko key parity assertion.
- **Live re-QA (ko)**: confirm the PRD no longer dead-ends and plan generation→confirmation completes (the exact two journeys this stage exists to fix).

## Out of scope (other stages)

The plan-step internal-prompt/PRD-JSON leak (NEW) → S-043/S-046 clean-conversation. P1-14/P1-15 plan-critique logging → S-042. Korean roadmap labels → S-043. Architecture decision → S-047.
