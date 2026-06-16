# Tasks: LLM Verification Coach

**Input**: Design documents from `specs/007-llm-verification-coach/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`,
`contracts/`

**Tests**: Required for evidence gating, EventLog/export, and UI behavior
because this feature changes verification and approval decisions.

**Organization**: Tasks are grouped by user story to enable independent
implementation and testing.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish typed contracts and command seams.

- [ ] T001 Add frontend verification-coach types in `dive/src/features/verification-coach/types.ts`
- [ ] T002 Add frontend verification-coach API wrapper in `dive/src/features/verification-coach/api.ts`
- [ ] T003 Add Rust verification-coach domain module in `dive/src-tauri/src/dive/verification_coach.rs`
- [ ] T004 Register Rust module exports in `dive/src-tauri/src/dive/mod.rs`
- [ ] T005 Add verification-coach IPC module in `dive/src-tauri/src/ipc/verification_coach.rs`
- [ ] T006 Register verification-coach IPC command in `dive/src-tauri/src/ipc/mod.rs` and `dive/src-tauri/src/lib.rs`
- [ ] T007 Add i18n copy for verification coach and observation evidence in `dive/src/i18n/en.json` and `dive/src/i18n/ko.json`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core evidence and logging behavior that all stories depend on.

- [ ] T008 Add verification coach context, guide, validation result, and drop reason structs in `dive/src-tauri/src/dive/verification_coach.rs`
- [ ] T009 Add deterministic guide validation tests in `dive/src-tauri/src/dive/verification_coach.rs`
- [ ] T010 Add EventLog payload builders or append helpers for `verification_coach.*` and `verification_observation.*` in `dive/src-tauri/src/dive/event_log.rs`
- [ ] T011 Add export sanitizer coverage for verification-coach EventLog payloads in `dive/src-tauri/src/export/mod.rs`
- [ ] T012 Extend concrete verification grading for criterion-linked manual observations in `dive/src/features/provocation/verificationGrade.ts`
- [ ] T013 Add verification-grade regression tests in `dive/src/features/provocation/verificationGrade.test.ts`
- [ ] T014 Extend approval provenance construction to include manual observation evidence in `dive/src/features/provocation/verificationStatus.ts`
- [ ] T015 Extend backend approval provenance mapping to preserve manual evidence summaries in `dive/src-tauri/src/ipc/cards.rs`

**Checkpoint**: Evidence model is ready; user story implementation can begin.

---

## Phase 3: User Story 1 - Get Step-Specific Verification Guidance (Priority: P1) MVP

**Goal**: Review panel shows adaptive guidance for how to verify the current
step, including CLI/manual/no-preview steps.

**Independent Test**: Open a CLI/manual step in review and verify the panel
shows concrete guidance instead of an empty review state.

### Tests for User Story 1

- [ ] T016 [P] [US1] Add Rust tests for coach context building across CLI/manual and no-preview steps in `dive/src-tauri/src/dive/verification_coach.rs`
- [ ] T017 [P] [US1] Add IPC tests for guidance shown/unavailable outcomes in `dive/src-tauri/src/ipc/tests.rs`
- [ ] T018 [P] [US1] Add StepDetail guidance rendering tests in `dive/src/components/product/StepDetailSlideIn.test.tsx`

### Implementation for User Story 1

- [ ] T019 [US1] Implement coach prompt/context construction in `dive/src-tauri/src/dive/verification_coach.rs`
- [ ] T020 [US1] Implement `verification_coach_generate` IPC command in `dive/src-tauri/src/ipc/verification_coach.rs`
- [ ] T021 [US1] Add `VerificationCoachPanel` component in `dive/src/components/product/VerificationCoachPanel.tsx`
- [ ] T022 [US1] Integrate `VerificationCoachPanel` into `dive/src/components/product/StepDetailSlideIn.tsx` near the verification focus area
- [ ] T023 [US1] Wire guidance generation from `dive/src/components/product/useProductShellController.ts`

**Checkpoint**: User Story 1 works independently.

---

## Phase 4: User Story 2 - Record User-Observed Evidence Before Approval (Priority: P1)

**Goal**: Student observations linked to completion criteria enable
evidence-backed approval, while missing observations keep risk/defer behavior.

**Independent Test**: Record a criterion-linked observation and approve; export
and roadmap state show verified evidence. Approve without observation remains
risk/deferred.

### Tests for User Story 2

- [ ] T024 [P] [US2] Add DecisionGate policy tests for manual observation evidence in `dive/src/components/product/DecisionGate.test.tsx`
- [ ] T025 [P] [US2] Add StepDetail observation capture tests in `dive/src/components/product/StepDetailSlideIn.test.tsx`
- [ ] T026 [P] [US2] Add approval provenance tests for observation evidence in `dive/src/features/provocation/__tests__/rules.test.ts`
- [ ] T027 [P] [US2] Add Rust approval/export tests for manual evidence summary in `dive/src-tauri/src/ipc/tests.rs`

### Implementation for User Story 2

- [ ] T028 [US2] Add observation state and criterion linking UI in `dive/src/components/product/VerificationCoachPanel.tsx`
- [ ] T029 [US2] Extend `ApprovalDecision` payload in `dive/src/components/workmap/ApprovalJudgment.tsx`
- [ ] T030 [US2] Pass observation evidence from `StepDetailSlideIn.tsx` to `useProductShellController.ts`
- [ ] T031 [US2] Include observation evidence in frontend `buildApprovalProvenance` calls in `dive/src/components/product/useProductShellController.ts`
- [ ] T032 [US2] Record observation EventLog entries through backend IPC in `dive/src-tauri/src/ipc/verification_coach.rs`
- [ ] T033 [US2] Persist observation summaries into step mapping evidence via approval transition in `dive/src-tauri/src/ipc/cards.rs`

**Checkpoint**: User Story 2 works independently.

---

## Phase 5: User Story 3 - Regenerate Or Refine Guidance As Evidence Changes (Priority: P2)

**Goal**: Student can refresh guidance after evidence changes without losing
recorded observations.

**Independent Test**: Generate guidance, add new evidence or failure state,
regenerate, and confirm the observation remains attached unless cleared.

### Tests for User Story 3

- [ ] T034 [P] [US3] Add regenerate guidance UI tests in `dive/src/components/product/StepDetailSlideIn.test.tsx`
- [ ] T035 [P] [US3] Add guide version correlation tests in `dive/src-tauri/src/ipc/tests.rs`

### Implementation for User Story 3

- [ ] T036 [US3] Add regenerate action and loading/error states in `dive/src/components/product/VerificationCoachPanel.tsx`
- [ ] T037 [US3] Preserve observation state across guide refreshes in `dive/src/components/product/StepDetailSlideIn.tsx`
- [ ] T038 [US3] Increment and log guide versions in `dive/src-tauri/src/ipc/verification_coach.rs`

**Checkpoint**: User Story 3 works independently.

---

## Phase 6: User Story 4 - Audit Guidance, Evidence, And Decisions (Priority: P3)

**Goal**: Export reconstructs guidance, observations, and approval outcomes.

**Independent Test**: Complete one evidence-backed and one risk-accepted
coached review, export the session, and confirm records are distinguishable.

### Tests for User Story 4

- [ ] T039 [P] [US4] Add export reconstruction tests in `dive/src-tauri/src/export/mod.rs`
- [ ] T040 [P] [US4] Add frontend logging integration tests in `dive/src/components/product/StepDetailSlideIn.test.tsx`

### Implementation for User Story 4

- [ ] T041 [US4] Finalize EventLog/export shaping for guidance and observation records in `dive/src-tauri/src/export/mod.rs`
- [ ] T042 [US4] Add user-text hashing/redaction coverage for observation text in `dive/src-tauri/src/export/mod.rs`
- [ ] T043 [US4] Update `docs/spec-status.md` with 007 implementation status after validation

**Checkpoint**: User Story 4 works independently.

---

## Final Phase: Polish & Cross-Cutting Concerns

- [ ] T044 [P] Run `pnpm typecheck` in `dive/`
- [ ] T045 [P] Run targeted Vitest suites for StepDetail, DecisionGate, and verification grade in `dive/`
- [ ] T046 [P] Run targeted Rust tests for verification coach, IPC, cards, and export in `dive/src-tauri/`
- [ ] T047 Run `pnpm test:unit` in `dive/`
- [ ] T048 Run Tauri app smoke for the DIVE_TEST9 Step1 review flow
- [ ] T049 Update `specs/007-llm-verification-coach/quickstart.md` with validation results

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on setup and blocks user stories.
- **US1 (Phase 3)**: MVP and required before observation capture.
- **US2 (Phase 4)**: Depends on US1 guidance placement and foundational evidence model.
- **US3 (Phase 5)**: Depends on US1; can be skipped for MVP if refresh is deferred.
- **US4 (Phase 6)**: Depends on US2 logging/provenance.
- **Polish**: Depends on desired story phases.

### Suggested MVP Scope

Implement Phase 1, Phase 2, User Story 1, and User Story 2 first. This directly
fixes the DIVE_TEST9 failure mode: review guidance appears for no-preview steps,
and criterion-linked user observation can complete the step as evidence-backed.

### Parallel Opportunities

- T001-T007 can be split by frontend/backend files.
- T009, T013, T016, T018, T024, and T025 can run in parallel after contracts
  exist.
- US3 and US4 can be deferred until the MVP is validated.
