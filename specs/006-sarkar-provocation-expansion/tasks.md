# Tasks: Sarkar Provocation Expansion

**Input**: Design documents from `specs/006-sarkar-provocation-expansion/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/)

**Tests**: Required by the feature spec success criteria and DIVE constitution for deterministic triggers, drop rules, EventLog/export, runtime boundaries, and UI placement.

**Organization**: Tasks are grouped by user story so each expanded event can be implemented and validated independently.

## Phase 1: Setup (Shared Planning Alignment)

**Purpose**: Confirm the active implementation scope before code changes.

- [ ] T001 Re-read the current supervisor/card inventory and record any code drift from `specs/006-sarkar-provocation-expansion/plan.md` in `specs/006-sarkar-provocation-expansion/research.md`
- [ ] T002 [P] Verify that public `generateProvocationCards` remains shipped-safe no-op and note any remaining production call sites in `specs/006-sarkar-provocation-expansion/quickstart.md`
- [ ] T003 [P] Update the 006 implementation checklist notes in `specs/006-sarkar-provocation-expansion/checklists/requirements.md` if implementation scope changes before coding

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared typed contracts, validation seams, and logging mappings required before any expanded event can ship.

**CRITICAL**: No user story implementation should render cards until this phase is complete.

### Tests

- [ ] T004 [P] Add TypeScript contract tests for expanded supervisor request unions and metadata normalization in `dive/src/features/provocation/adapters.test.ts`
- [ ] T005 [P] Add Rust serialization and validation tests for `plan_drafted`, `diff_ready`, and `retry_loop` supervisor events in `dive/src-tauri/src/dive/supervisor.rs`
- [ ] T006 [P] Add IPC tests that expanded events return no fallback card on runtime unavailable, timeout, malformed output, and domain-shell output in `dive/src-tauri/src/ipc/provocation_agent.rs`
- [ ] T007 [P] Add EventLog agency enrichment tests for expanded supervisor events in `dive/src-tauri/src/dive/event_log.rs`

### Implementation

- [ ] T008 Extend `SupervisorEvent`, assessment request unions, artifact refs, action allowlists, and card type enums in `dive/src/features/provocation/types.ts`
- [ ] T009 Extend `SupervisorEvent`, `EvidenceKind`, `SupervisorActionId`, assessment structs, card types, card stages, concerns, and card copy mapping in `dive/src-tauri/src/dive/supervisor.rs`
- [ ] T010 Extend supervisor prompt action instructions and event-specific concern validation in `dive/src-tauri/src/dive/supervisor.rs`
- [ ] T011 Extend `ProvocationAgentEvaluateRequest` and event-specific context building in `dive/src-tauri/src/ipc/provocation_agent.rs`
- [ ] T012 Generalize expanded-card metadata injection and action filtering in `dive/src/features/provocation/adapters.ts`
- [ ] T013 Extend `provocation.supervisor_evaluated` agency component/state inference for `plan_drafted`, `diff_ready`, and `retry_loop` in `dive/src-tauri/src/dive/event_log.rs`
- [ ] T014 Update EventLog/export contract documentation emitted by plan artifacts in `dive/src-tauri/src/workspace_plan/artifacts.rs`

**Checkpoint**: Expanded supervisor events can be parsed, gated, validated, logged, and safely dropped without rendering any new UI card.

---

## Phase 3: User Story 1 - Question Weak Plan Drafts Before Approval (Priority: P1) MVP

**Goal**: Show at most one SupervisorAgent-backed card near plan approval when a draft is weakly judgeable, without static fallback.

**Independent Test**: A weak plan draft can produce one contextual card beside plan approval; a well-scoped plan or invalid supervisor output shows no card.

### Tests

- [ ] T015 [P] [US1] Add Rust tests for weak-plan vs good-plan deterministic `plan_drafted` gates in `dive/src-tauri/src/dive/supervisor.rs`
- [ ] T016 [P] [US1] Add IPC tests for `plan_drafted` shown, no-card, dropped, timeout, and unavailable outcomes in `dive/src-tauri/src/ipc/provocation_agent.rs`
- [ ] T017 [P] [US1] Add frontend tests that `PlanDraftApprovalScreen` invokes backend evaluation, renders one returned card, and never falls back to rule cards in `dive/src/components/product/PlanDraftApprovalScreen.test.tsx`
- [ ] T018 [P] [US1] Add frontend adapter tests for `createPlanDraftSupervisorRequest` evidence refs and allowed actions in `dive/src/features/provocation/adapters.test.ts`

### Implementation

- [ ] T019 [US1] Add `PlanDraftReviewAssessment` request builder and evidence hashing helpers in `dive/src/features/provocation/adapters.ts`
- [ ] T020 [US1] Add plan-draft evidence refs for goal, acceptance criteria, step verification coverage, criterion linkage, broad steps, dependencies, and unresolved questions in `dive/src/features/provocation/adapters.ts`
- [ ] T021 [US1] Add Rust `build_plan_drafted_supervisor_context` and assessment normalization in `dive/src-tauri/src/dive/supervisor.rs`
- [ ] T022 [US1] Add `plan_drafted` deterministic provoke gate, expected concern, card type, stage, title, message, and action allowlist in `dive/src-tauri/src/dive/supervisor.rs`
- [ ] T023 [US1] Replace shipped no-op rule-card generation with backend `plan_drafted` evaluation in `dive/src/components/product/PlanDraftApprovalScreen.tsx`
- [ ] T024 [US1] Route plan-draft card actions to revision, criterion linking, verification-step addition, PRD editing, or dismiss behavior in `dive/src/components/product/PlanDraftApprovalScreen.tsx`
- [ ] T025 [US1] Ensure `PlanDraftApprovalScreen` suppresses duplicate plan cards for the same draft/evidence identity in `dive/src/components/product/PlanDraftApprovalScreen.tsx`

**Checkpoint**: User Story 1 is functional and testable as the MVP.

---

## Phase 4: User Story 2 - Challenge Suspicious Diffs Near The Changed Work (Priority: P2)

**Goal**: Show one card near changed-work review when changed files indicate possible scope drift, but stay silent for expected files only.

**Independent Test**: Unexpected/high-risk changed files can produce one card near step/diff review; expected-only changes do not.

### Tests

- [ ] T026 [P] [US2] Add Rust tests for `diff_ready` gates covering unexpected files, high-risk files, expected-only files, no changed files, and missing evidence refs in `dive/src-tauri/src/dive/supervisor.rs`
- [ ] T027 [P] [US2] Add IPC tests for `diff_ready` shown, no-card, dropped, timeout, and unavailable outcomes in `dive/src-tauri/src/ipc/provocation_agent.rs`
- [ ] T028 [P] [US2] Add frontend tests that `StepDetailSlideIn` renders a `diff_ready` card near changed-work review and opens CodeTab through `open_diff` in `dive/src/components/product/StepDetailSlideIn.test.tsx`
- [ ] T029 [P] [US2] Add adapter tests for expected-file comparison, high-risk path categorization, and raw diff omission in `dive/src/features/provocation/adapters.test.ts`

### Implementation

- [ ] T030 [US2] Add `DiffReadyReviewAssessment` request builder and evidence hashing helpers in `dive/src/features/provocation/adapters.ts`
- [ ] T031 [US2] Add bounded changed-file, expected-file, PRD-scope, step-scope, and diff-view evidence refs in `dive/src/features/provocation/adapters.ts`
- [ ] T032 [US2] Add Rust `build_diff_ready_supervisor_context` and assessment normalization in `dive/src-tauri/src/dive/supervisor.rs`
- [ ] T033 [US2] Add `diff_ready` deterministic provoke gate that rejects changed-file-count-only evidence in `dive/src-tauri/src/dive/supervisor.rs`
- [ ] T034 [US2] Add `diff_ready` card type, stage, expected concern, action allowlist, title, and message mapping in `dive/src-tauri/src/dive/supervisor.rs`
- [ ] T035 [US2] Trigger `diff_ready` evaluation from changed-work/step-review context in `dive/src/components/product/StepDetailSlideIn.tsx`
- [ ] T036 [US2] Coordinate `diff_ready` and existing `verify_entered` evaluations so only one relevant primary card appears per decision point in `dive/src/components/product/StepDetailSlideIn.tsx`
- [ ] T037 [US2] Route diff card actions to diff opening, rationale request, unrelated-change recovery, tests, or dismiss in `dive/src/features/provocation/useProvocationActionResolver.ts`

**Checkpoint**: User Story 2 works independently without affecting plan-draft cards.

---

## Phase 5: User Story 3 - Interrupt Unproductive Retry Loops (Priority: P3)

**Goal**: Show one recovery-oriented card after the same step-scoped failure repeats at least twice without success.

**Independent Test**: A second same-fingerprint failure can produce one card near failure/recovery; one failure, successful verification, recovery, or a different failure stays silent.

### Tests

- [ ] T038 [P] [US3] Add Rust tests for `retry_loop` eligibility, reset on success/recovery, different failure fingerprints, and duplicate evidence hashes in `dive/src-tauri/src/dive/supervisor.rs`
- [ ] T039 [P] [US3] Add IPC tests for `retry_loop` shown, no-card, dropped, timeout, unavailable, and no-domain-shell-fallback outcomes in `dive/src-tauri/src/ipc/provocation_agent.rs`
- [ ] T040 [P] [US3] Add frontend tests for step-scoped repeated failure detection and card placement near verification/recovery in `dive/src/components/product/StepDetailSlideIn.test.tsx`
- [ ] T041 [P] [US3] Add retry-loop adapter tests that normalized failure evidence omits raw stdout/stderr and terminal bodies in `dive/src/features/provocation/adapters.test.ts`

### Implementation

- [ ] T042 [US3] Add `RetryLoopReviewAssessment` request builder, failure fingerprinting, bounded failure summaries, and evidence hashing helpers in `dive/src/features/provocation/adapters.ts`
- [ ] T043 [US3] Add step-scoped retry-loop state derivation from verification and terminal snapshots in `dive/src/features/provocation/adapters.ts`
- [ ] T044 [US3] Add Rust `build_retry_loop_supervisor_context` and assessment normalization in `dive/src-tauri/src/dive/supervisor.rs`
- [ ] T045 [US3] Add `retry_loop` deterministic provoke gate requiring `failureCount >= 2`, same active step, same fingerprint, and no success/reset evidence in `dive/src-tauri/src/dive/supervisor.rs`
- [ ] T046 [US3] Add `retry_loop` card type, stage, expected concern, action allowlist, title, and message mapping in `dive/src-tauri/src/dive/supervisor.rs`
- [ ] T047 [US3] Trigger `retry_loop` evaluation near the verification failure/recovery area in `dive/src/components/product/StepDetailSlideIn.tsx`
- [ ] T048 [US3] Keep `TerminalTab` free of global rule-card heuristics and only allow backend-backed retry cards when active step/session evidence is available in `dive/src/components/slide-in/TerminalTab.tsx`
- [ ] T049 [US3] Route retry-loop actions to repro creation, rollback/recovery, diff inspection, test rerun, plan split, or dismiss in `dive/src/features/provocation/useProvocationActionResolver.ts`

**Checkpoint**: User Story 3 works independently and does not revive the old terminal rule-card path.

---

## Phase 6: User Story 4 - Audit Expanded Provocation Coverage (Priority: P4)

**Goal**: Export shown, silent, dropped, and responded expanded evaluations with enough bounded evidence to reconstruct why cards appeared or stayed silent.

**Independent Test**: A sample export containing shown `plan_drafted`, silent `diff_ready`, and dropped `retry_loop` evaluations preserves event, artifact, evidence, validation, drop, card, and response correlation without raw secrets.

### Tests

- [ ] T050 [P] [US4] Add EventLog tests that expanded supervisor logs include event, artifact, evidence refs, validation outcome, drop reason, decision summary, and evaluation id in `dive/src-tauri/src/dive/event_log.rs`
- [ ] T051 [P] [US4] Add export sanitizer tests for expanded plan, diff, and retry evidence without raw diff, raw terminal output, code bodies, secrets, tokens, or student PII in `dive/src-tauri/src/export/mod.rs`
- [ ] T052 [P] [US4] Add frontend logging tests for card exposure, action, dismiss, and mark-irrelevant response correlation on expanded cards in `dive/src/features/provocation/logging.test.ts`

### Implementation

- [ ] T053 [US4] Add assessment summary fields to `SupervisorEvaluationLog` payload creation in `dive/src-tauri/src/dive/supervisor.rs`
- [ ] T054 [US4] Extend response metadata propagation for expanded event, artifact, project, plan, context hash, and evidence hash in `dive/src/features/provocation/adapters.ts`
- [ ] T055 [US4] Extend EventLog enrichment mappings for expanded event agency component, state, risk level, affected files, affected commands, evidence summary, and decision in `dive/src-tauri/src/dive/event_log.rs`
- [ ] T056 [US4] Extend export sanitization or allowlist behavior for expanded supervisor evidence summaries in `dive/src-tauri/src/export/mod.rs`
- [ ] T057 [US4] Update EventLog/export contract descriptions for 006 expanded supervisor coverage in `dive/src-tauri/src/workspace_plan/artifacts.rs`

**Checkpoint**: User Story 4 export/audit behavior is complete.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final integration, regression coverage, docs, and validation.

- [ ] T058 [P] Add regression coverage that `scope_expansion` still shows/drops through SupervisorAgent with no static fallback in `dive/src-tauri/src/ipc/provocation_agent.rs`
- [ ] T059 [P] Add regression coverage that `verify_entered` still only cards on AI-self-report without concrete evidence in `dive/src/components/product/StepDetailSlideIn.test.tsx`
- [ ] T060 [P] Add regression coverage that public `generateProvocationCards` remains no-op in shipped builds in `dive/src/features/provocation/__tests__/rules.test.ts`
- [ ] T061 Update Korean and English review-card copy only where new card types need user-visible strings in `dive/src/i18n/ko.json` and `dive/src/i18n/en.json`
- [ ] T062 Update 006 validation results and command evidence in `specs/006-sarkar-provocation-expansion/quickstart.md`
- [ ] T063 Update canonical implementation status for 006 in `docs/spec-status.md`
- [ ] T064 Run frontend typecheck and focused Vitest commands from `specs/006-sarkar-provocation-expansion/quickstart.md`
- [ ] T065 Run focused Rust tests and full `cargo test` commands from `specs/006-sarkar-provocation-expansion/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: No dependencies.
- **Phase 2 Foundational**: Depends on Phase 1 and blocks all new card rendering.
- **US1 Plan Draft (Phase 3)**: Depends on Phase 2 and is the MVP.
- **US2 Diff Ready (Phase 4)**: Depends on Phase 2; can run after or in parallel with US1 once shared contracts are stable.
- **US3 Retry Loop (Phase 5)**: Depends on Phase 2; can run after or in parallel with US1/US2 once shared contracts are stable.
- **US4 Audit (Phase 6)**: Depends on the event contracts from Phase 2 and should be finalized after the stories it exports.
- **Polish (Phase 7)**: Depends on selected story phases.

### User Story Dependencies

- **US1 (P1)**: No dependency on US2 or US3 after Phase 2.
- **US2 (P2)**: No dependency on US1 behavior, but shares `StepDetailSlideIn` with existing `verify_entered`.
- **US3 (P3)**: No dependency on US1/US2, but shares action allowlists and `StepDetailSlideIn` card arbitration.
- **US4 (P4)**: Depends on expanded event payloads from US1, US2, and US3 for full validation.

### Parallel Opportunities

- T004-T007 can be written in parallel because they touch different test files.
- T015-T018, T026-T029, T038-T041, and T050-T052 are parallelizable test groups.
- US1 backend tasks T021-T022 and frontend tasks T023-T025 can proceed in parallel after T019-T020.
- US2 backend tasks T032-T034 and frontend tasks T035-T037 can proceed in parallel after T030-T031.
- US3 backend tasks T044-T046 and frontend tasks T047-T049 can proceed in parallel after T042-T043.

---

## Parallel Example: User Story 1

```text
Task: "T015 [P] [US1] Add Rust tests for weak-plan vs good-plan deterministic plan_drafted gates in dive/src-tauri/src/dive/supervisor.rs"
Task: "T017 [P] [US1] Add frontend tests that PlanDraftApprovalScreen invokes backend evaluation, renders one returned card, and never falls back to rule cards in dive/src/components/product/PlanDraftApprovalScreen.test.tsx"
Task: "T018 [P] [US1] Add frontend adapter tests for createPlanDraftSupervisorRequest evidence refs and allowed actions in dive/src/features/provocation/adapters.test.ts"
```

---

## Implementation Strategy

### MVP First

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3 (US1 `plan_drafted`).
3. Validate US1 independently with focused Rust, adapter, and UI tests.
4. Stop before US2/US3 if the MVP needs review.

### Incremental Delivery

1. Foundation contracts and no-fallback safety.
2. US1 plan-draft review card.
3. US2 diff-ready review card.
4. US3 retry-loop review card.
5. US4 export/audit completeness.
6. Polish, regression, and quickstart validation.

### Safety Rules

- Do not re-enable shipped frontend keyword/list rule cards.
- Do not render expanded cards as chat assistant messages.
- Do not add legacy runtime fallback or provider fallback routing.
- Do not treat AI self-report as verification evidence.
- Keep all expanded cards non-blocking, sparse, evidence-grounded, dismissible, and logged/exportable.

