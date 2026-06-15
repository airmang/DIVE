# Tasks: PRD-Driven Decompose & Plan Lifecycle

**Input**: Design documents from `specs/004-prd-decompose-lifecycle/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`,
`quickstart.md`, and `contracts/`

**Tests**: Tests are required for this DIVE v2 feature because the constitution
requires deterministic coverage for workflow gates, typed seams, EventLog/export,
and contextual UI behavior.

**Organization**: Tasks are grouped by user story so each story can be delivered
and tested independently after the shared foundation.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish shared type and copy surfaces before storage, IPC, and UI
work begins.

- [X] T001 [P] Add ProjectSpec, LiveProjectSpecDraft, InterviewTurn, PrdPatch, AcceptanceCriterion, DecompositionRationale, PlanMutation, ScopeExpansionAssessment, and Objection TypeScript contracts in `dive/src/features/planning/types.ts`
- [X] T002 [P] Add ProjectSpec, ProjectSpecVersion, PlanMutation, Objection, AcceptanceCriterion, DecompositionRationale, PrdPatch, and ScopeExpansionAssessment Rust model structs in `dive/src-tauri/src/db/models.rs`
- [X] T003 [P] Add Korean and English PRD authoring/read-view/decomposition/add-step copy keys in `dive/src/i18n/ko.json`
- [X] T004 [P] Mirror the new PRD authoring/read-view/decomposition/add-step copy keys in `dive/src/i18n/en.json`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Add deterministic adapters, persistence, redaction, and export seams
that all user stories depend on.

**Critical**: No user story implementation should begin until this phase is
complete.

- [X] T005 [P] Add unit tests for legacy criteria adaptation, stable criterion ID allocation, and PRD minimal validation in `dive/src/features/planning/projectSpec.test.ts`
- [X] T006 [P] Add unit tests for PrdPatch validation, merge behavior, conflict hold, and changed-field reporting in `dive/src/features/planning/prdPatch.test.ts`
- [X] T007 [P] Add Rust migration and DAO roundtrip tests for PRD versions and plan mutations in `dive/src-tauri/tests/workspace_prd_lifecycle.rs`
- [X] T008 Implement legacy criteria adaptation, stable ID allocation, PRD minimal validation, and ProjectSpecDraft helpers in `dive/src/features/planning/projectSpec.ts`
- [X] T009 Implement PrdPatch allowlist validation, size limits, merge policy, student-edit conflict handling, and changed-field reporting in `dive/src/features/planning/prdPatch.ts`
- [X] T010 Add schema version 11 tables or JSON-backed columns for project spec versions, live PRD drafts, plan mutations, and objections in `dive/src-tauri/src/db/migrations.rs`
- [X] T011 Implement ProjectSpec version and draft persistence helpers in `dive/src-tauri/src/db/dao/prd.rs`
- [X] T012 Implement PlanMutation and Objection persistence helpers in `dive/src-tauri/src/db/dao/plan_mutation.rs`
- [X] T013 Export the new PRD and plan-mutation DAO modules in `dive/src-tauri/src/db/dao/mod.rs`
- [X] T014 Add redacted EventLog payload builders for prd_patch_proposed, prd_patch_applied, prd_patch_rejected, prd_authored, prd_edited, prd_version_created, plan_step_rationale_challenged, plan_step_appended, and plan_step_changed in `dive/src-tauri/src/dive/event_log.rs`
- [X] T015 Extend `.dive` artifact export helpers to include current PRD, PRD versions, criteria links, rationales, objections, and mutation metadata in `dive/src-tauri/src/workspace_plan/artifacts.rs`

**Checkpoint**: PRD and plan lifecycle data can be typed, validated, persisted,
logged, and exported before any UI depends on it.

---

## Phase 3: User Story 1 - Interview Authors A Living PRD (Priority: P1) MVP

**Goal**: A new project must go from provider setup into PRD authoring, each
interview turn may update a live PRD draft through validated patches, saving
creates a version, and the saved PRD opens in a concise read view.

**Independent Test**: Start with a project and provider but no PRD; onboarding
shows PRD as current, PRD Authoring Board renders provider/model selection plus
live canvas, a validated patch updates the draft without versioning, save logs a
version, and the Final PRD Read View appears without interview or patch UI.

### Tests for User Story 1

- [X] T016 [P] [US1] Add Rust IPC tests for workspace_prd_status, workspace_prd_get, workspace_prd_interview_turn, workspace_prd_save, and missing-PRD plan generation refusal in `dive/src-tauri/tests/workspace_plan_ipc.rs`
- [X] T017 [P] [US1] Add hook tests for PRD IPC methods and draft/status normalization in `dive/src/features/planning/usePlan.test.ts`
- [X] T018 [P] [US1] Extend onboarding logic tests for project -> provider -> PRD -> plan/session ordering and PRD draft resume behavior in `dive/src/components/product/productShellConversationLogic.test.ts`
- [X] T019 [P] [US1] Add PRD Authoring Board UI tests for board regions, provider/model selector, minimal validation, patch highlight, and student-edit conflict handling in `dive/src/components/product/PrdAuthoringBoard.test.tsx`
- [X] T020 [P] [US1] Add Final PRD Read View tests for concise layout, hidden interview/patch/edit controls, and edit action routing in `dive/src/components/product/FinalPrdReadView.test.tsx`

### Implementation for User Story 1

- [X] T021 [US1] Add ProjectSpec payloads and workspace_prd_status, workspace_prd_get, workspace_prd_interview_turn, and workspace_prd_save implementations in `dive/src-tauri/src/ipc/workspace_plan.rs`
- [X] T022 [US1] Register workspace_prd_status, workspace_prd_get, workspace_prd_interview_turn, and workspace_prd_save in `dive/src-tauri/src/lib.rs`
- [X] T023 [US1] Extend `WorkspacePlanStatus` to include PRD status, draft resume state, and minimal PRD gating in `dive/src-tauri/src/ipc/workspace_plan.rs`
- [X] T024 [US1] Require a minimal saved PRD before workspace_plan_generate_draft can persist a draft plan in `dive/src-tauri/src/ipc/workspace_plan.rs`
- [X] T025 [US1] Add usePlan PRD methods for status, get, interview turn, save, and refresh after PRD version creation in `dive/src/features/planning/usePlan.ts`
- [X] T026 [US1] Replace the chat-swapped interview surface with a dedicated PRD authoring state passed from the product shell in `dive/src/components/product/useProductShellController.ts`
- [X] T027 [US1] Create the PRD Authoring Board with compact header, interview rail, live PRD canvas, bottom action bar, provider/model selection, patch feedback, and minimal validation in `dive/src/components/product/PrdAuthoringBoard.tsx`
- [X] T028 [US1] Keep `SocraticInterviewPanel` only as an internal rail or retire it behind PRD Authoring Board compatibility in `dive/src/components/product/SocraticInterviewPanel.tsx`
- [X] T029 [US1] Create the concise Final PRD Read View with goal, acceptance criteria, scope boundary, constraints, version metadata, Edit PRD, and Create Plan actions in `dive/src/components/product/FinalPrdReadView.tsx`
- [X] T030 [US1] Update ChatArea to render the PRD authoring/read surfaces without losing normal composer and model selection behavior in `dive/src/components/shell/ChatArea.tsx`
- [X] T031 [US1] Extend GetStartedStepKey and checklist rendering for the required PRD step in `dive/src/components/product/GetStartedChecklist.tsx`
- [X] T032 [US1] Update deriveGetStartedModel to route project/provider completion into PRD authoring before plan/session in `dive/src/components/product/productShellConversationLogic.ts`
- [X] T033 [US1] Wire PRD board open, draft restore, save-to-read-view, edit-mode reopen, and create-plan transition actions in `dive/src/components/product/useProductShellController.ts`
- [X] T034 [US1] Emit prd_patch_proposed, prd_patch_applied, prd_patch_rejected, prd_authored, prd_edited, and prd_version_created events from PRD IPC flows in `dive/src-tauri/src/ipc/workspace_plan.rs`

**Checkpoint**: User Story 1 is independently usable as the MVP: PRD before
decompose, authoring board, turn-by-turn patching, version save, and concise read
view all work without implementing challenge or add-step flows.

---

## Phase 4: User Story 2 - Criterion-Linked, Challengeable Decomposition (Priority: P1)

**Goal**: Every generated plan step shows linked PRD criteria and a short
rationale, and the student can challenge the rationale without blocking
execution.

**Independent Test**: Generate a plan from a saved PRD with multiple criteria;
each step persists and renders at least one linked criterion ID plus rationale,
and a rationale objection is logged while continue/start controls remain
available.

### Tests for User Story 2

- [X] T035 [P] [US2] Add Rust tests rejecting generated steps without linkedCriterionIds or rationale and accepting legacy string-array criteria through adapters in `dive/src-tauri/tests/workspace_plan_ipc.rs`
- [X] T036 [P] [US2] Add decoder tests for object-form criteria, linkedCriterionIds, and rationale in `dive/src/features/planning/usePlanInterviewLLM.test.ts`
- [X] T037 [P] [US2] Extend PlanDraftApprovalScreen tests for criterion IDs, criterion text, and step rationale rendering in `dive/src/components/product/PlanDraftApprovalScreen.test.tsx`
- [X] T038 [P] [US2] Extend StepDetailSlideIn tests for linked criteria, rationale, challenge action, and non-blocking controls in `dive/src/components/product/StepDetailSlideIn.test.tsx`

### Implementation for User Story 2

- [X] T039 [US2] Extend StepDraftInput and PlanDraftInput to accept object-form criteria, linkedCriterionIds, and rationale in `dive/src/features/planning/types.ts`
- [X] T040 [US2] Decode LLM plan drafts into stable criteria links and per-step rationale, preserving legacy payload compatibility in `dive/src/features/planning/usePlanInterviewLLM.ts`
- [X] T041 [US2] Extend Rust StepDraftInput and PlanDraftInput validation for linked criterion IDs and rationale in `dive/src-tauri/src/ipc/workspace_plan.rs`
- [X] T042 [US2] Persist linkedCriterionIds and rationale with each generated step while maintaining legacy acceptance_criteria reads in `dive/src-tauri/src/ipc/workspace_plan.rs`
- [X] T043 [US2] Normalize linked criteria and rationale into roadmap step view models in `dive/src/features/roadmap/usePlanRoadmap.ts`
- [X] T044 [US2] Add linked criteria and rationale fields to roadmap TypeScript types in `dive/src/features/roadmap/types.ts`
- [X] T045 [US2] Render criterion IDs, criterion text, and rationale in plan draft review rows in `dive/src/components/product/PlanDraftApprovalScreen.tsx`
- [X] T046 [US2] Render criterion IDs and rationale on active roadmap cards in `dive/src/components/product/RoadmapPanel.tsx`
- [X] T047 [US2] Render linked criteria, rationale, and a why-this-step challenge affordance in `dive/src/components/product/StepDetailSlideIn.tsx`
- [X] T048 [US2] Add workspace_plan_challenge_step_rationale implementation and objection EventLog writing in `dive/src-tauri/src/ipc/workspace_plan.rs`
- [X] T049 [US2] Register workspace_plan_challenge_step_rationale in `dive/src-tauri/src/lib.rs`
- [X] T050 [US2] Add a usePlan challengeStepRationale method and refresh behavior in `dive/src/features/planning/usePlan.ts`
- [X] T051 [US2] Export step criterion links, rationale, and objections in `dive/src-tauri/src/workspace_plan/artifacts.rs`

**Checkpoint**: User Story 2 can ship after US1 with criterion-linked,
challengeable decomposition and no blocking changes to verify/approval flow.

---

## Phase 5: User Story 3 - Add A Step Mid-Implementation (Priority: P2)

**Goal**: A student can add a step from a dedicated plan area, the mutation is
logged, the PRD updates, and scope expansion can surface a non-blocking review
card through the specs/002 path.

**Independent Test**: Approve a plan, add a step from the dedicated plan area,
confirm workspace_plan_append_step persists the step and PlanMutation, confirm
the PRD version/delta updates, and confirm scope-expansion review-card handling
is contextual and non-blocking.

### Tests for User Story 3

- [X] T052 [P] [US3] Extend append-step IPC tests for mutationReason, linkedCriterionIds, prdDelta, PRD version delta, PlanMutation persistence, and plan_step_appended payloads in `dive/src-tauri/tests/workspace_plan_ipc.rs`
- [X] T053 [P] [US3] Add deterministic scope expansion tests for missing criterion link, new scope area, and out-of-scope target files in `dive/src-tauri/tests/workspace_prd_lifecycle.rs`
- [X] T054 [P] [US3] Add dedicated add-step UI tests for one-action save, criterion linking assistance, PRD delta preview, and no chat-only mutation in `dive/src/components/product/PlanDashboardPanel.test.tsx`
- [X] T055 [P] [US3] Add provocation integration tests for non-blocking scope-expansion card placement near the add-step area in `dive/src/features/provocation/__tests__/rules.test.ts`

### Implementation for User Story 3

- [X] T056 [US3] Extend workspace_plan_append_step input parsing for mutationReason, linkedCriterionIds, and prdDelta in `dive/src-tauri/src/ipc/workspace_plan.rs`
- [X] T057 [US3] Implement deterministic scope-expansion assessment with reason codes and evidence references in `dive/src-tauri/src/ipc/workspace_plan.rs`
- [X] T058 [US3] Persist PlanMutation, update PRD version/delta state, and emit plan_step_appended from append-step flow in `dive/src-tauri/src/ipc/workspace_plan.rs`
- [X] T059 [US3] Add usePlan append-step mutation payload support in `dive/src/features/planning/usePlan.ts`
- [X] T060 [US3] Create a dedicated add-step form with title, reason, expected files, optional criteria links, optional verification check, and PRD delta preview in `dive/src/components/product/PlanAddStepPanel.tsx`
- [X] T061 [US3] Mount the dedicated add-step area in the plan dashboard without using ordinary chat as the mutation path in `dive/src/components/product/PlanDashboardPanel.tsx`
- [X] T062 [US3] Update route confirmation copy so chat may propose but never silently appends a step without dedicated-area confirmation in `dive/src/components/product/PlanRouteConfirmModal.tsx`
- [X] T063 [US3] Invoke the existing specs/002 review-card path for expanded scope and keep the card non-blocking near add-step UI in `dive/src/components/product/PlanAddStepPanel.tsx`
- [X] T064 [US3] Export PlanMutation records, PRD deltas, and added-step reconstruction data in `dive/src-tauri/src/workspace_plan/artifacts.rs`

**Checkpoint**: User Story 3 can ship after US1 and US2 with low-friction
dedicated add-step mutation and contextual, evidence-grounded scope review.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final verification, regression checks, and documentation alignment.

- [ ] T065 [P] Update 004 quickstart implementation notes with any final command or file-path changes in `specs/004-prd-decompose-lifecycle/quickstart.md`
- [ ] T066 [P] Update active spec status after implementation completion in `docs/spec-status.md`
- [ ] T067 Run TypeScript typecheck for the app with `pnpm typecheck` from `dive/package.json`
- [ ] T068 Run frontend unit tests with `pnpm test:unit` from `dive/package.json`
- [ ] T069 Run Rust tests with `cargo test` from `dive/src-tauri/Cargo.toml`
- [ ] T070 Run targeted quickstart scenarios for PRD authoring, final read view, criterion-linked decomposition, rationale challenge, add-step mutation, scope card, and export using `specs/004-prd-decompose-lifecycle/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: No dependencies.
- **Phase 2 Foundational**: Depends on Phase 1 and blocks all user stories.
- **Phase 3 US1**: Depends on Phase 2 and is the MVP.
- **Phase 4 US2**: Depends on Phase 2 and benefits from US1's PRD persistence; implement after US1 for product coherence.
- **Phase 5 US3**: Depends on Phase 2 and should follow US1/US2 so add-step mutations can link to PRD criteria and rationales.
- **Phase 6 Polish**: Depends on all implemented stories.

### User Story Dependencies

- **US1 (P1)**: MVP; no dependency on US2 or US3.
- **US2 (P1)**: Requires a saved PRD contract from US1 for full end-to-end testing.
- **US3 (P2)**: Requires saved PRD and criterion-link contracts from US1/US2 for complete scope-expansion behavior.

### Within Each User Story

- Run story tests first and confirm they fail for missing behavior.
- Implement Rust persistence/IPC before frontend hooks.
- Implement hooks/types before UI.
- Complete EventLog/export changes before marking the story done.
- Validate each story independently at its checkpoint before continuing.

---

## Parallel Opportunities

- T001-T004 can run in parallel.
- T005-T007 can run in parallel before T008-T015.
- US1 tests T016-T020 can run in parallel after Phase 2.
- US2 tests T035-T038 can run in parallel after Phase 2.
- US3 tests T052-T055 can run in parallel after Phase 2.
- UI components that do not share the same file can be developed in parallel once hooks and types exist.

## Parallel Example: User Story 1

```text
Task: T016 Rust IPC tests in dive/src-tauri/tests/workspace_plan_ipc.rs
Task: T017 usePlan hook tests in dive/src/features/planning/usePlan.test.ts
Task: T019 PRD Authoring Board tests in dive/src/components/product/PrdAuthoringBoard.test.tsx
Task: T020 Final PRD Read View tests in dive/src/components/product/FinalPrdReadView.test.tsx
```

## Parallel Example: User Story 2

```text
Task: T036 decoder tests in dive/src/features/planning/usePlanInterviewLLM.test.ts
Task: T037 plan draft review UI tests in dive/src/components/product/PlanDraftApprovalScreen.test.tsx
Task: T038 step detail UI tests in dive/src/components/product/StepDetailSlideIn.test.tsx
```

## Implementation Strategy

### MVP First

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3 only.
3. Validate PRD-before-decompose, authoring board, validated PRD patches, PRD version save, and Final PRD Read View.
4. Stop for review before implementing criterion-linked decomposition and add-step mutation.

### Incremental Delivery

1. US1: PRD artifact and onboarding bridge.
2. US2: criterion-linked, challengeable decomposition.
3. US3: dedicated add-step mutation and scope-expansion review-card integration.
4. Polish: exports, regression checks, and quickstart completion.

### Regression Guardrails

- Do not add legacy runtime fallback, provider fallback routing, Node-side file/process mutation, Pi built-in tools, or shell fallback.
- Do not turn PRD authoring into a quiz, score, badge, standalone lesson, or long wizard.
- Keep Work Mode low-friction; only the minimal PRD gate blocks decomposition.
- Keep review-card content and presentation delegated to specs/002 and specs/003.
- Keep user-facing Korean labels on "검토 카드" or "확인 필요 카드", not "도발카드".
