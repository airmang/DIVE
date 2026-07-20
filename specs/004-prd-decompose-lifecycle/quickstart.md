# Quickstart: PRD-Driven Decompose & Plan Lifecycle

Use this guide during implementation to validate 004 end to end.

## Prerequisites

- DIVE repo checked out.
- Existing dependencies installed under `dive/`.
- Test database migrations run through normal Tauri test setup.

## Core Commands

```bash
cd dive
pnpm typecheck
pnpm test:unit
cd src-tauri
cargo test
```

## Implementation Notes

Run commands from the repository checkout at
`~/DIVE-2`. The app package is still under
`dive/`, and Rust tests still run from `dive/src-tauri/`; no command path changed
during 004 implementation.

Rust mock-provider integration suites are declared with
`required-features = ["dev-mock"]` in `dive/src-tauri/Cargo.toml`. The required
S-015 command remains plain `cargo test`; use `cargo test --features dev-mock`
when validating the extended legacy/mock-provider integration suites.

Primary implementation surfaces now used by this quickstart:

- PRD authoring/read view: `dive/src/components/product/PrdAuthoringBoard.tsx`,
  `dive/src/components/product/FinalPrdReadView.tsx`,
  `dive/src/components/product/useProductShellController.ts`, and
  `dive/src-tauri/src/ipc/workspace_plan.rs`.
- Criterion-linked decomposition and rationale challenge:
  `dive/src/features/planning/usePlanInterviewLLM.ts`,
  `dive/src/components/product/PlanDraftApprovalScreen.tsx`,
  `dive/src/components/product/StepDetailSlideIn.tsx`, and
  `dive/src-tauri/src/workspace_plan/artifacts.rs`.
- Add-step mutation, scope-expansion card, and export reconstruction:
  `dive/src/components/product/PlanAddStepPanel.tsx`,
  `dive/src/components/product/PlanDashboardPanel.tsx`,
  `dive/src/features/provocation/rules.ts`, and
  `dive/src-tauri/src/workspace_plan/artifacts.rs`.

Targeted scenario coverage is expected from the named unit/Rust suites below,
plus a manual/Computer Use pass through the running app when S-015 is validated.

## Scenario 1: PRD Before Decompose

1. Start a new project.
2. Complete or simulate provider/model setup.
3. Confirm onboarding marks PRD authoring as the current step before any generic
   session/plan execution.
4. Confirm the first planning surface is the PRD Authoring Board, not ordinary
   chat or a wizard.
5. Confirm the board shows provider/model selection, interview rail, live PRD
   canvas, and bottom action bar.
6. Attempt to reach decomposition before saving a minimal PRD.
7. Expected: the primary create-plan action is disabled until goal and at least
   one acceptance criterion exist.
8. Save the PRD through the board.
9. Expected: `prd_authored` and `prd_version_created` are logged; PRD is
   openable and editable.

Suggested tests:

- Rust test for plan draft generation refusing missing PRD.
- React test for onboarding PRD current step.
- React test for PRD Authoring Board regions and provider/model selector.
- EventLog test for `prd_authored` redaction.

Implemented coverage:

- `dive/src-tauri/tests/workspace_plan_ipc.rs`
- `dive/src/components/product/productShellConversationLogic.test.ts`
- `dive/src/components/product/PrdAuthoringBoard.test.tsx`
- `dive/src/features/planning/usePlan.test.ts`

## Scenario 1A: Resume PRD Draft From Onboarding

1. Start a project with provider/model configured and a PRD draft that lacks a
   valid acceptance criterion.
2. Open first-run onboarding.
3. Expected: onboarding current action resumes the PRD Authoring Board with the
   existing draft, not ordinary chat and not a fresh blank PRD.
4. Add an acceptance criterion and save.
5. Expected: onboarding advances to plan generation/review.

## Scenario 1B: Interview Turn Applies Validated PRD Patch

1. Open the PRD Authoring Board with an empty or partial live draft.
2. Submit an interview answer that describes a goal or completion criterion.
3. Expected: the LLM returns a conversational response plus a `PrdPatch`.
4. Expected: DIVE validates and applies the patch to the visible canvas.
5. Expected: changed fields are highlighted, and no official PRD version is
   created until the student saves.
6. Directly edit a field, then submit another answer whose patch conflicts with
   that field.
7. Expected: the student edit wins; the conflicting patch is held or rejected
   unless explicitly accepted.

Suggested tests:

- Rust/TS validation test rejecting unknown patch operations.
- Unit test assigning criterion IDs during patch merge.
- React test showing changed-field highlight after applied patch.
- EventLog/export test for `prd_patch_proposed`, `prd_patch_applied`, and
  `prd_patch_rejected`.

Implemented coverage:

- `dive/src/features/planning/prdPatch.test.ts`
- `dive/src/features/planning/projectSpec.test.ts`
- `dive/src/components/product/PrdAuthoringBoard.test.tsx`
- `dive/src-tauri/tests/workspace_plan_ipc.rs`

## Scenario 1C: Saved PRD Uses Concise Read View

1. Complete a minimal PRD in the PRD Authoring Board.
2. Click `Save PRD & Create Plan` or save the PRD.
3. Expected: DIVE shows the Final PRD Read View, not the authoring board.
4. Expected: the read view shows goal, acceptance criteria, scope/out-of-scope,
   key constraints, version metadata, and create/review plan action.
5. Expected: interview rail, patch status, validation hints, and inline field
   editors are not visible.
6. Click edit.
7. Expected: DIVE reopens the PRD Authoring Board or equivalent edit mode.

Suggested tests:

- React test for read-view layout after PRD save.
- React test that read view does not render interview rail or patch controls.
- React test that edit action opens PRD authoring/edit mode.

Implemented coverage:

- `dive/src/components/product/FinalPrdReadView.test.tsx`
- `dive/src/components/product/useProductShellController.ts`

## Scenario 2: Criterion-Linked Decomposition

1. Generate a plan from a PRD with at least two acceptance criteria.
2. Expected: every step stores and renders at least one linked criterion ID.
3. Expected: every step stores and renders a short rationale.
4. Export `.dive/plan.json`.
5. Expected: exported step artifacts include linked criteria and rationale.

Suggested tests:

- TypeScript decoder test for object-form criteria and rationale.
- Rust validation test rejecting a generated step with no criterion link.
- UI test in `PlanDraftApprovalScreen` or `StepDetailSlideIn`.

Implemented coverage:

- `dive/src/features/planning/usePlanInterviewLLM.test.ts`
- `dive/src-tauri/tests/workspace_plan_ipc.rs`
- `dive/src/components/product/PlanDraftApprovalScreen.test.tsx`
- `dive/src/components/product/StepDetailSlideIn.test.tsx`

## Scenario 3: Challenge A Step Rationale

1. Open a generated step.
2. Trigger "why this step?" / challenge action.
3. Submit a short objection.
4. Expected: `plan_step_rationale_challenged` is logged.
5. Expected: execution is not blocked.
6. If a suggestion appears, it requires explicit acceptance.

Suggested tests:

- IPC test for `workspace_plan_challenge_step_rationale`.
- React test that objection UI does not disable continue/start controls.

Implemented coverage:

- `dive/src-tauri/tests/workspace_plan_ipc.rs`
- `dive/src/components/product/StepDetailSlideIn.test.tsx`
- `dive/src/features/planning/usePlan.test.ts`

## Scenario 4: Add Step Mid-Implementation

1. Approve a plan and open an active roadmap.
2. Use the dedicated plan area to add a small step.
3. Expected: `workspace_plan_append_step` persists the step and assigns the next
   stable step ID.
4. Expected: PRD version/mutation state updates.
5. Expected: `plan_step_appended` includes mutation ID, criteria links, and PRD
   delta summary.

Suggested tests:

- Existing append-step Rust tests extended for mutation payload.
- React test for dedicated add-step area.
- Export test reconstructing the added step and PRD delta.

Implemented coverage:

- `dive/src-tauri/tests/workspace_plan_ipc.rs`
- `dive/src-tauri/tests/workspace_plan_artifacts.rs`
- `dive/src/components/product/PlanDashboardPanel.test.tsx`

## Scenario 5: Scope Expansion Review Card

1. Add a step that lacks criterion links or clearly expands scope.
2. Expected: deterministic scope-expansion assessment marks the mutation as
   expanded with reason codes.
3. Expected: specs/002 review-card path may show a non-blocking card near the
   add-step area.
4. Expected: dismiss/mark-irrelevant/action logging follows existing
   review-card event paths.

Suggested tests:

- Unit test for scope-expansion reason codes.
- Provocation integration test for non-blocking card placement.

Implemented coverage:

- `dive/src-tauri/tests/workspace_prd_lifecycle.rs`
- `dive/src/features/provocation/__tests__/rules.test.ts`
- `dive/src/components/product/PlanDashboardPanel.test.tsx`

## S-015 Validation Results

Validated on 2026-06-15 for Wily Stage S-015:

- `pnpm typecheck` from `dive/`: passed.
- `pnpm test:unit` from `dive/`: passed, 39 files and 188 tests.
- Initial plain `cargo test` from `dive/src-tauri/`: failed because
  MockProvider integration test targets imported a dev-mock-only provider
  without declaring `required-features = ["dev-mock"]`.
- Fix applied: `dive/src-tauri/Cargo.toml` now declares
  `required-features = ["dev-mock"]` for MockProvider integration test targets.
- `cargo test --features dev-mock` from `dive/src-tauri/`: passed; use this for
  extended mock-provider integration coverage.
- Required plain `cargo test` from `dive/src-tauri/` after the fix: passed,
  including the 004 Rust IPC/export/lifecycle suites.
- Computer Use/browser smoke at `http://localhost:1420/`: passed. The app loaded
  without console warnings/errors and rendered the first-run checklist with the
  PRD step before plan/session creation.

Scenario evidence:

- PRD authoring: `PrdAuthoringBoard.test.tsx`,
  `productShellConversationLogic.test.ts`, `usePlan.test.ts`, and
  `workspace_plan_ipc.rs`.
- Final PRD Read View: `FinalPrdReadView.test.tsx` and product-shell routing
  coverage.
- Criterion-linked decomposition: `usePlanInterviewLLM.test.ts`,
  `PlanDraftApprovalScreen.test.tsx`, `StepDetailSlideIn.test.tsx`, and
  `workspace_plan_ipc.rs`.
- Rationale challenge: `StepDetailSlideIn.test.tsx`, `usePlan.test.ts`, and
  `workspace_plan_ipc.rs`.
- Add-step mutation: `PlanDashboardPanel.test.tsx`,
  `workspace_plan_ipc.rs`, and `workspace_plan_artifacts.rs`.
- Scope-expansion card: `rules.test.ts`, `PlanDashboardPanel.test.tsx`, and
  `workspace_prd_lifecycle.rs`.
- Export reconstruction: `workspace_plan_artifacts.rs` and the export assertions
  in `workspace_plan_ipc.rs`.

## Regression Checks

- Existing approved plans with string-array criteria still render.
- Existing plan approval and verify/final approval flow logic is unchanged.
- Work Mode remains low-friction.
- No generated UI labels use "도발카드" as the primary student-facing term.
