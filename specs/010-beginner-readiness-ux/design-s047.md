# S-047 Design — PRD interview: mandatory architecture decision (Theme 7)

**Stage**: Wily `S-047` (dive-2, owner-added; register via `design_stage` **after owner approves this design**) · **Spec**: [spec.md](spec.md) Theme 7 · **Branch**: `010-beginner-readiness-ux`

**Status**: **APPROVED (owner 2026-07-01)** — decisions locked: **Q1 = bounded form enum + free-text stack**; **Q2 = decomposition context-only**; **Q3 = single Stage S-047** (full cross-language feature in one Stage). Implementing autonomously.

**Evidence/source**: owner feedback 2026-06-29 ("반드시 어느 아키텍처로 만들건지 정해야 할 것 같은데 그걸 안 정하고 넘어가네"). Reuses specs/004 PRD patch/validation/versioning + Final PRD Read View. Part (b) (neutralize the biased answer placeholder) is **already done** — this Stage is part (a) only.

## Problem

`ProjectSpec`/PRD captures goal, intent, scope, non-goals, constraints, and acceptance criteria but has **no concept of architecture/stack**, and the interview never raises it. A student confirms the PRD and decomposes into a plan without ever deciding *how* the project is built, so the AI silently picks a stack mid-build. There must be an explicit, student-owned architecture decision recorded on the PRD before it is confirmable.

## Decision (constitution-aligned)

Add a first-class, versioned, exportable **`ArchitectureDecision` (form + stack + rationale + source)** on the `ProjectSpec`, decided during the interview as a **two-stage recommend-then-confirm**: DIVE's AI proposes ≤2 suitable options with short plain-language novice rationale; the **student explicitly confirms or changes** — the AI never auto-finalizes (human agency, Constitution VI: LLM proposes, DIVE records). It becomes a `validateConfirmableProjectSpec` requirement (not confirmable until **form + stack** are decided), shows in the Final PRD Read View, is editable by reopening the board, and flows into decomposition so steps match the chosen form+stack. **No jargon quiz / long wizard / score / badge** (Constitution I/V). Pre-010 PRDs without an architecture stay openable and must decide one at their next confirm/edit.

## Data model

New (TS `features/planning/types.ts` + Rust `db/models.rs`, kept in sync — DIVE-authoritative):
```
ArchitectureForm  = "web_app" | "static_page" | "cli_tool" | "desktop_app" | "api_service" | "other"
ArchitectureDecisionSource = "student_confirmed" | "student_changed" | "migration"
ArchitectureDecision {
  form: ArchitectureForm
  formOtherLabel?: string        // free text only when form === "other"
  stack: string                  // concrete stack, free text (AI-proposed, student-editable), e.g. "React + Vite + TypeScript"
  rationale: string | null       // plain-language why (from the accepted proposal, editable)
  decisionSource: ArchitectureDecisionSource
  decidedInVersion: number       // PRD version at decision (versioned/exportable)
}
ProjectSpec.architecture: ArchitectureDecision | null   // null until decided; Option<..> in Rust (serde default None → old rows migrate cleanly)
```
**Form = bounded enum** (so "a stack consistent with that form" is checkable and the UI can show a small fixed set, not an open jargon prompt) with an `other` escape hatch. **Stack = free text** (AI proposes, student edits) — bounding stacks to an enum would be a jargon quiz. *(Owner decision point Q1 below.)*

## Interview flow (two-stage, recommend-then-confirm)

Driven by the existing gap/focus mechanism (`confirmable_draft_gaps` → `focus:` instructions in `workspace_plan.rs`; the AI answers the current focus). Two new gaps, only after goal/intent/scope exist (so the form recommendation is grounded):
1. **Form** gap → focus: "propose ≤2 application forms (web app / static page / CLI tool / desktop / API) that fit this goal, each with a one-line plain-Korean reason; ask the student to pick or change — do not decide for them." The AI's proposal is surfaced as **options** (not an auto-applied patch).
2. **Stack** gap (only once form decided) → focus: "propose ≤2 concrete stacks consistent with the chosen {{form}}, each with a one-line beginner reason; ask the student to pick or change."

**Application is student-originated** (no AI auto-finalize): the student's pick/change in the board sets `spec.architecture` through the ordinary **student-edit draft-save path** (`updateSpecField` → `markDraftStudentEdited` → draft upsert), stamped `decisionSource = student_confirmed` (or `student_changed` on a form switch) and `decidedInVersion` on the confirm/version-commit save. DIVE records it (draft row + versioned `ProjectSpec` snapshot).

> **As-built refinement (2026-07-01, adversarial-verify validated).** The original sketch routed this through a new `set_architecture` `PrdPatch` op. Implementation instead uses the draft-save path, which is **strictly stronger on Constitution VI**: the AI-facing patch shape (`RawPrdPatchOperation`) does not even carry architecture fields and `set_architecture` is not a supported op, so an AI interview patch is **structurally incapable** of authoring an architecture — vs. an op path that would need a runtime "student-provenance only" guard to reject AI attempts. The form is enum-typed (serde rejects out-of-enum values) and the stack is trimmed/normalized on save; the two-stage bar is enforced by `validateConfirmableProjectSpec` (frontend) and `is_confirmable_project_spec` (Rust save backstop). The 3-lens adversarial review confirmed this mechanism is clean on agency and correctness. The `set_architecture` PrdPatch op is therefore **not** implemented (no dead op fields kept).

## Confirmable gate + message

`validateConfirmableProjectSpec` (TS `projectSpec.ts`) + `is_confirmable_project_spec`/`confirmable_draft_gaps` (Rust) add: form missing → `missing_architecture_form`; stack missing → `missing_architecture_stack`. New localized reason strings ("아키텍처(형태)를 아직 정하지 않았어요" / "기술 스택을 아직 정하지 않았어요" + en). Confirm button stays disabled with a per-field reason (reuses the S-041 gate-field-as-guidance pattern).

## UI

- **`PrdAuthoringBoard.tsx`**: a new **Architecture** canvas section (near the other PRD fields, always-on gloss per S-045 style): shows the decided form+stack when set, or — when the AI has proposed options — renders the ≤2 options as selectable cards with the plain rationale + a **confirm** and an **change/edit** affordance (student can type a different stack). Recommend-then-confirm; the option cards are the AI proposal, the student's click is the decision. AI-applied `data-changed` highlight per P1-31 (S-041 already highlights applied edits).
- **`FinalPrdReadView.tsx`**: an Architecture row (form label + stack + rationale), reusing the read-view style.

> **As-built (2026-07-10).** The option-card surface was specified above but initially shipped without it: the board rendered only the fixed form-enum buttons and a blank free-text stack field, so the AI's recommendation (chat prose only) never reached the board — the student had to retype it, and the architecture was the one PRD section the conversation could not fill. Now implemented end-to-end: the interview turn emits an optional structured `proposals` object (`{kind:"form"|"stack", options:[{value, rationale}]}`) alongside the patch; Rust shape-validates it (bounded form values, ≤2, trimmed) and **focus-gates** it to the deterministic two-stage gap the model was answering (`expected_architecture_proposal_kind`), so off-focus/stale cards never surface; `PrdInterviewTurnOutput.architectureProposals` carries it to the board, which renders selectable cards (`prd-architecture-{form,stack}-proposal-*`). A card click routes through the existing student-edit path (`setArchitectureForm` / `patchArchitecture`) — the AI still authors nothing (no `set_architecture` op; Constitution VI preserved). Cards clear once the matching field is decided. Tests: Rust `sanitize_*` / `expected_proposal_kind_*` / `parse_turn_response_extracts_proposals_*`; TS board render-and-pick specs.

## Decomposition / plan

The decomposition prompt (Rust) gains the chosen `form`+`stack` as context so generated steps match it (e.g. a static-page form must not produce a backend step). Grounding only — no new gate.

## Migration

`ProjectSpec.architecture` is `Option`/nullable with serde-default `None`; existing PRDs deserialize with `architecture: null` and stay openable. They surface the architecture gap at their next confirm/edit (the gate fires only on confirm, not on open). `decisionSource: "migration"` is reserved if we ever backfill; not used at rest.

## Test strategy

- **Vitest**: `validateConfirmableProjectSpec` rejects a spec missing form and/or stack and accepts once both are set; PrdAuthoringBoard picks a form then a stack and only then enables Confirm (two-stage gate through the real UI); `draftFromProjectSpec` carries architecture across edit→reopen (data-loss regression guard); `buildPrdPlanGenerationPrompt` threads form+stack context; FinalPrdReadView shows the architecture (and omits the block when none); en/ko parity for the new keys.
- **Rust** (`--features dev-mock`): `is_confirmable_project_spec` / the `workspace_prd_save` backstop reject a missing or half-decided (form-only, no stack) architecture; `confirmable_draft_gaps` emits the form then stack focus in order; a pre-010 snapshot (no architecture) deserializes to `None` and stays openable; interview focus prompts recommend-then-confirm form then stack; decomposition context includes form+stack.
- **Live re-QA (ko)**: run the interview to the point the AI proposes ≤2 forms → pick one → AI proposes ≤2 stacks → pick one → Confirm enables; reopen the board and change the stack; confirm the Final PRD Read View shows it.

## Out of scope / preserve
- No jargon quiz / wizard / score / badge; the AI proposes and the student decides (Constitution I/V/VI). No AI auto-finalize. Preserve S-041–S-046 behavior + specs/004 patch/version/export semantics.

## Resolved decisions (owner 2026-07-01)
- **Q1 — Form taxonomy = bounded enum** `web_app | static_page | cli_tool | desktop_app | api_service | other` (+ `formOtherLabel` free text for `other`); **stack = free text** (AI-proposed, student-editable).
- **Q2 — Decomposition = context-only** (pass form+stack as grounding to the decomposition prompt; form-specific step templates / step-vs-form validation are a follow-up). **Follow-up CLOSED in S-049 (2026-07-02)**: `buildPrdPlanGenerationPrompt` now injects a deterministic per-form scaffolding block, and a deterministic non-blocking `plan_form_consistency` check logs form/step contradictions to the EventLog (`plan.form_consistency`) — no user-facing card or gate (Constitution V). See `design-s049.md`.
- **Q3 — Single Stage S-047** (full cross-language feature: TS + Rust models, validation, interview, UI, i18n, tests in one Stage).
