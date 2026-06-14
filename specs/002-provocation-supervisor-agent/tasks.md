# Tasks: Provocation Supervisor Agent

**Input**: Design documents from `specs/002-provocation-supervisor-agent/`

**Prerequisites**: [spec.md](./spec.md), [plan.md](./plan.md),
[research.md](./research.md), [data-model.md](./data-model.md),
[contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Required by the spec and constitution. Write or update tests before
the implementation they cover where practical, and keep each user story
independently verifiable.

**Organization**: Tasks are grouped by user story so P1 can ship as MVP, then
P2/P3 can harden the supervisor boundary and research ledger without changing
the product contract.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with other marked tasks in the same phase because
  it touches different files and has no dependency on their uncompleted edits.
- **[Story]**: User story label from [spec.md](./spec.md): US1, US2, US3.
- Every task names the target file path(s).

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prepare the implementation surface and remove ambiguity before
domain work begins.

- [X] T001 Re-grep all `generateProvocationCards` call sites and update the inventory in `specs/002-provocation-supervisor-agent/implementation-gap.md`
- [X] T002 Classify the remaining unclassified provocation files in `specs/002-provocation-supervisor-agent/implementation-gap.md`
- [X] T003 [P] Add a Rust module declaration placeholder for supervisor domain work in `dive/src-tauri/src/dive/mod.rs`
- [X] T004 [P] Add a Rust IPC module declaration placeholder for supervisor evaluation in `dive/src-tauri/src/ipc/mod.rs`
- [X] T005 [P] Add frontend API placeholder types for supervisor evaluation in `dive/src/features/provocation/types.ts`
- [X] T006 Confirm the Wily Stage mapping notes before creating Wily stages from `specs/002-provocation-supervisor-agent/tasks.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core deterministic contracts that all user stories depend on.

**Critical**: No user-story implementation should begin until these typed
contracts and failing tests are in place.

- [X] T007 [P] Add supervisor domain unit-test scaffolding for mode normalization, hashes, validation outcomes, and drop reasons in `dive/src-tauri/src/dive/supervisor.rs`
- [X] T008 [P] Add sidecar supervisor boundary test scaffolding for zero enabled tools and no resource-discovered prompts/instructions in `dive/src-tauri/src/pi_sidecar.rs`
- [X] T009 [P] Add export sanitizer regression test scaffolding for supervisor evaluation payloads in `dive/src-tauri/src/export/mod.rs`
- [X] T010 Add `SupervisorMode`, `SourceUiMode`, mode normalization, and `invalid_mode` drop handling in `dive/src-tauri/src/dive/supervisor.rs`
- [X] T011 Add `ArtifactRef`, `EvidenceRef`, `VerificationState`, `VerificationFeasibility`, and `SupervisorContext` structs in `dive/src-tauri/src/dive/supervisor.rs`
- [X] T012 Add `SupervisorDecision`, `SupervisorValidationResult`, `SupervisorEvaluationLog`, and stable drop reason enums in `dive/src-tauri/src/dive/supervisor.rs`
- [X] T013 Implement canonical serialization, `contextHash`, `evidenceHash`, and deterministic `cardId` generation in `dive/src-tauri/src/dive/supervisor.rs`
- [X] T014 Implement session-scoped dedup state for `(artifactRef, concern, evidenceHash)` in `dive/src-tauri/src/dive/supervisor.rs`
- [X] T015 Implement strict `SupervisorDecision` parsing and validation for schema version, concern, evidence refs, question shape, length caps, action stripping, and proceed-action rejection in `dive/src-tauri/src/dive/supervisor.rs`
- [X] T016 Add `SupervisorContext` to `ProvocationCard` mapping for P1 `ai_self_report_only` cards, including evidence/action caps, in `dive/src-tauri/src/dive/supervisor.rs`
- [X] T017 Update Rust module exports for supervisor domain use in `dive/src-tauri/src/dive/mod.rs`

**Checkpoint**: Rust deterministic domain contract exists and can be tested
without Pi runtime or frontend integration.

---

## Phase 3: User Story 1 - Confirmation Needed After AI Claims Done (Priority: P1) MVP

**Goal**: When AI claims completion and DIVE has no concrete verification
evidence, the verify/final approval surface shows one grounded confirmation
card or logs a no-card/drop outcome without fallback.

**Independent Test**: Run a session where the assistant claims completion, no
test result/diff review/preview/app/manual check is recorded, and the user
enters final approval. One nearby card appears; when concrete evidence exists,
no `ai_self_report_only` card appears; when supervisor is unavailable, no
fallback card appears and the result is logged.

### Tests for User Story 1

- [X] T018 [P] [US1] Add Rust tests for `ai_claimed_done` evidence recording, P1 provoke gate outcomes, and no-card concrete-evidence cases in `dive/src-tauri/src/dive/supervisor.rs`
- [X] T019 [P] [US1] Add Rust tests for `provocation_agent_evaluate` request/response mapping, timeout, and post-finalization late-result drop in `dive/src-tauri/src/ipc/provocation_agent.rs`
- [X] T020 [P] [US1] Add Vitest coverage for verify-surface card placement, Korean review-card labels, no `도발카드` main label, and no-chat rendering in `dive/src/components/product/StepDetailSlideIn.test.tsx`
- [X] T021 [P] [US1] Add Vitest coverage for canonical two-mode behavior in `dive/src/features/provocation/ProvocationCard.test.tsx`

### Implementation for User Story 1

- [X] T022 [US1] Implement Rust `ai_claimed_done` assistant-claim evidence recording and `SupervisorContext` construction from verify/final approval UI state in `dive/src-tauri/src/dive/supervisor.rs`
- [X] T023 [US1] Implement P1 deterministic provoke gate `aiSelfReport && !concreteEvidence` in `dive/src-tauri/src/dive/supervisor.rs`
- [X] T024 [US1] Add `provocation_agent_evaluate` Tauri command request/response structs in `dive/src-tauri/src/ipc/provocation_agent.rs`
- [X] T025 [US1] Register `provocation_agent_evaluate` in `dive/src-tauri/src/ipc/mod.rs` and `dive/src-tauri/src/lib.rs`
- [X] T026 [US1] Add frontend invoke wrapper and response adapter for `provocation_agent_evaluate` in `dive/src/features/provocation/adapters.ts`
- [X] T027 [US1] Replace `verify_entered` card generation in `dive/src/components/product/StepDetailSlideIn.tsx` with the backend supervisor evaluation response
- [X] T028 [US1] Disable frontend `generateProvocationCards` as the shipped P1 final path in `dive/src/features/provocation/useProvocationCards.ts`
- [X] T029 [US1] Remove `expert` suppression from P1 card visibility and keep ranking-only behavior in `dive/src/features/provocation/priority.ts`
- [X] T030 [US1] Update `ProvocationCard` rendering to consume canonical `work | guided` behavior while preserving migration input compatibility in `dive/src/features/provocation/ProvocationCard.tsx`
- [X] T031 [US1] Wire supervisor-backed card actions through the existing resolver without adding proceed actions to LLM suggestions in `dive/src/features/provocation/useProvocationActionResolver.ts`

**Checkpoint**: US1 is usable as MVP with deterministic DIVE gate, one valid
card at verification/final approval, and no static fallback.

---

## Phase 4: User Story 2 - Supervisor Critiques Evidence Without Taking Over (Priority: P2)

**Goal**: SupervisorAgent can generate a contextual criterion-linked question,
but cannot use tools, inspect files, invent evidence, create arbitrary actions,
or override DIVE validation.

**Independent Test**: Feed a fixed evidence bundle to the supervisor path and
verify that malformed output, invalid refs, non-question text, duplicate
concerns, disallowed proceed actions, and unavailable runtime produce no card
or stripped actions according to contract.

### Tests for User Story 2

- [X] T032 [P] [US2] Add Rust validator tests for malformed JSON, unsupported schema, missing evidence, unknown evidence, non-question, over-length question, evidence/action caps, disallowed concern, duplicate, and `provoke=false` in `dive/src-tauri/src/dive/supervisor.rs`
- [X] T033 [P] [US2] Add Rust tests proving `continue_with_risk` and `verification_deferred` are rejected as SupervisorAgent `suggestedActionIds` in `dive/src-tauri/src/dive/supervisor.rs`
- [X] T034 [P] [US2] Add Pi sidecar supervisor tests for explicit `tools: []`, `enabled_tools == []`, and no resource-discovered prompts/instructions in `dive/src-tauri/src/pi_sidecar.rs`
- [X] T035 [P] [US2] Add frontend tests that infeasible verify actions are not rendered as card actions in `dive/src/features/provocation/ProvocationCard.test.tsx`

### Implementation for User Story 2

- [X] T036 [US2] Add supervisor prompt builder that includes only bounded `SupervisorContext` JSON and requests one JSON object in `dive/src-tauri/src/dive/supervisor.rs`
- [X] T037 [US2] Add `run_supervisor_turn` with explicit `tools: []`, short timeout, model metadata, latency capture, and zero-tool assertion in `dive/src-tauri/src/pi_sidecar.rs`
- [X] T038 [US2] Extend sidecar protocol handling for supervisor turn success/error paths without enabling `dive_context` fallback in `dive/src-tauri/src/pi_sidecar/protocol.rs`
- [X] T039 [US2] Connect `provocation_agent_evaluate` to `run_supervisor_turn`, deterministic validation, timeout, and post-finalization late-result drop in `dive/src-tauri/src/ipc/provocation_agent.rs`
- [X] T040 [US2] Implement feasibility computation for `runnable`, `previewable`, `hasTests`, and `diffAvailable` before allowed-action construction in `dive/src-tauri/src/dive/supervisor.rs`
- [X] T041 [US2] Filter `allowedActionIds` to feasible verification nudges only in `dive/src-tauri/src/dive/supervisor.rs`
- [X] T042 [US2] Prevent no-op preview/app/test actions from being offered by the frontend resolver in `dive/src/features/provocation/useProvocationActionResolver.ts`
- [X] T043 [US2] Stop click-only preview/app handlers from recording verification evidence before an actual observation in `dive/src/components/product/StepDetailSlideIn.tsx`
- [X] T044 [US2] Add `verification_deferred` as a non-risk DecisionGate outcome for infeasible verification in `dive/src/components/product/decisionGatePolicy.ts`
- [X] T045 [US2] Render a clearly labeled non-risk deferred-verification proceed affordance in `dive/src/components/product/DecisionGate.tsx`
- [X] T046 [US2] Tie acceptance-criterion confirmation to an actual observation/evidence ref instead of a bare checkbox in `dive/src/components/product/StepDetailSlideIn.tsx`
- [X] T047 [US2] Align `hasConcreteVerification` usage across verification status and grade helpers in `dive/src/features/provocation/verificationStatus.ts`
- [X] T048 [US2] Align roadmap agency state with the canonical concrete-evidence definition in `dive/src/features/roadmap/agencyStatus.ts`

**Checkpoint**: US2 proves the supervisor is bounded and DIVE remains the
authority for evidence, actions, feasibility, and proceed semantics.

---

## Phase 5: User Story 3 - Researcher Audits Why Cards Appeared Or Stayed Silent (Priority: P3)

**Goal**: Local export reconstructs supervisor evaluations, evidence,
shown/none/dropped/error outcomes, user responses, and privacy-preserving
decision summaries.

**Independent Test**: Export a session with one shown card, one dropped invalid
decision, one supervisor runtime failure, and one card response. The export
contains sanitized `provocation.supervisor_evaluated` records and separates AI
self-report from concrete verification evidence.

### Tests for User Story 3

- [X] T049 [P] [US3] Add EventLog tests for `provocation.supervisor_evaluated` shown/none/dropped/error payload enrichment in `dive/src-tauri/src/dive/event_log.rs`
- [X] T050 [P] [US3] Add export sanitizer tests for supervisor decision summaries, evidence refs, raw code, raw diff, terminal output, secrets, and student PII in `dive/src-tauri/src/export/mod.rs`
- [X] T051 [P] [US3] Add frontend logging tests for `supervisorEvaluationId` correlation on exposure/action/dismiss/mark-irrelevant in `dive/src/features/provocation/logging.test.ts`

### Implementation for User Story 3

- [X] T052 [US3] Add `provocation.supervisor_evaluated` EventLog append helper for shown/none/dropped/error outcomes in `dive/src-tauri/src/dive/event_log.rs`
- [X] T053 [US3] Persist supervisor evaluation logs from `provocation_agent_evaluate` before any card exposure logs in `dive/src-tauri/src/ipc/provocation_agent.rs`
- [X] T054 [US3] Extend export sanitization for supervisor evaluation payloads in `dive/src-tauri/src/export/mod.rs`
- [X] T055 [US3] Add `supervisorEvaluationId`, `contextHash`, and `evidenceHash` metadata correlation to mapped cards in `dive/src-tauri/src/dive/supervisor.rs`
- [X] T056 [US3] Attach `supervisorEvaluationId` to frontend exposure, action, dismiss, and mark-irrelevant logs in `dive/src/features/provocation/logging.ts`
- [X] T057 [US3] Ensure DecisionGate logs distinguish `verification_deferred` from `continue_with_risk` in `dive/src/components/product/DecisionGate.tsx`
- [X] T058 [US3] Ensure approval provenance/export does not record `verified_with_evidence` from weaker preview/app/viewed signals in `dive/src/features/provocation/logging.ts`

**Checkpoint**: US3 export shows why cards appeared or stayed silent without
leaking raw project content, secrets, or unmasked student PII.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final consistency, dead-path cleanup, and validation across the
feature.

- [X] T059 [P] Update provocation barrel exports for new supervisor-facing types in `dive/src/features/provocation/index.ts`
- [X] T060 [P] Remove or quarantine P1 keyword/list rule behavior from shipped/classroom builds in `dive/src/features/provocation/rules.ts`
- [X] T061 [P] Update `generateProvocationCards` call-site tests or delete obsolete expectations in `dive/src/features/provocation/__tests__/rules.test.ts`
- [X] T062 [P] Confirm `SocraticInterviewPanel` remains outside shipped P1 review-card behavior or remove its rule-card dependency in `dive/src/components/product/SocraticInterviewPanel.tsx`
- [X] T063 [P] Update task/implementation notes after final classification in `specs/002-provocation-supervisor-agent/implementation-gap.md`
- [X] T064 Run `cargo test supervisor` and record results against `specs/002-provocation-supervisor-agent/quickstart.md`
- [X] T065 Run `cargo test pi_sidecar_supervisor` and record results against `specs/002-provocation-supervisor-agent/quickstart.md`
- [X] T066 Run `pnpm typecheck` and `pnpm test:unit` from `dive/package.json`
- [X] T067 Run the manual verify/final approval scenarios from `specs/002-provocation-supervisor-agent/quickstart.md`
- [X] T068 Review `specs/003-supervision-card-ux/spec.md` compatibility with the final rendered card fields in `dive/src/features/provocation/ProvocationCard.tsx`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: No dependencies.
- **Phase 2 Foundational**: Depends on Phase 1; blocks all user stories.
- **Phase 3 US1 MVP**: Depends on Phase 2.
- **Phase 4 US2**: Depends on Phase 2; can start before US1 UI wiring is
  complete only for Rust/sidecar tests, but final integration depends on US1
  command and mapping contracts.
- **Phase 5 US3**: Depends on Phase 2; export/log implementation depends on
  the evaluation contract from US1/US2.
- **Phase 6 Polish**: Depends on the desired user stories being complete.

### User Story Dependencies

- **US1 (P1)**: MVP; no dependency on US2/US3 after foundational contracts.
- **US2 (P2)**: Hardens runtime, validation, feasibility, and DecisionGate
  authority; depends on the shared domain contract and integrates with US1.
- **US3 (P3)**: Adds research-ledger completeness; depends on evaluation
  outcomes produced by US1/US2.

### Within Each User Story

- Tests first where practical.
- Rust domain/validator before IPC.
- IPC before frontend integration.
- Feasibility/action filtering before rendering actions.
- EventLog append before export validation.

---

## Parallel Opportunities

- T003, T004, and T005 can be done in parallel.
- T007, T008, and T009 can be written in parallel.
- T018 through T021 can be written in parallel after Phase 2.
- T032 through T035 can be written in parallel after Phase 2.
- T049 through T051 can be written in parallel after Phase 2.
- T059 through T063 can be done in parallel after user-story integration settles.

## Parallel Example: User Story 1

```text
Task: "T018 [US1] Add Rust tests for P1 provoke gate outcomes in dive/src-tauri/src/dive/supervisor.rs"
Task: "T019 [US1] Add Rust tests for provocation_agent_evaluate mapping in dive/src-tauri/src/ipc/provocation_agent.rs"
Task: "T020 [US1] Add verify-surface card placement tests in dive/src/components/product/StepDetailSlideIn.test.tsx"
Task: "T021 [US1] Add canonical two-mode card behavior tests in dive/src/features/provocation/ProvocationCard.test.tsx"
```

## Parallel Example: User Story 2

```text
Task: "T032 [US2] Add validator drop-rule tests in dive/src-tauri/src/dive/supervisor.rs"
Task: "T034 [US2] Add zero-tool sidecar tests in dive/src-tauri/src/pi_sidecar.rs"
Task: "T035 [US2] Add infeasible action rendering tests in dive/src/features/provocation/ProvocationCard.test.tsx"
```

## Suggested Wily Stage Mapping

Stage A confirmation (2026-06-14): mapping reviewed for Stage A-F grouping
below. No Wily stages were created or mutated during this Stage A-only pass.

- **Stage A - Spec/Task Finalization**: T001-T006
- **Stage B - Supervisor Domain Core**: T007-T017
- **Stage C - P1 Verify Card MVP**: T018-T031
- **Stage D - Pi Boundary And Feasibility Hardening**: T032-T048
- **Stage E - Research Ledger And Export**: T049-T058
- **Stage F - Cleanup And Validation**: T059-T068

## Implementation Strategy

### MVP First (US1 Only)

1. Complete Phase 1 setup.
2. Complete Phase 2 foundational Rust contracts and tests.
3. Complete Phase 3 US1.
4. Stop and validate the US1 independent test and quickstart Scenario A/B.

### Incremental Delivery

1. Deliver US1 MVP card behavior without fallback.
2. Add US2 zero-tool supervisor runtime, validation hardening, feasibility, and
   DecisionGate non-trapping behavior.
3. Add US3 EventLog/export audit completeness.
4. Finish polish and full quickstart validation.

### Notes

- Do not add legacy runtime fallback, static provocation fallback, standalone
  card decks, generic warning banners, or AI-self-report-as-verification.
- `continue_with_risk` and `verification_deferred` are DecisionGate outcomes,
  not SupervisorAgent `suggestedActionIds`.
- Keep Work Mode non-blocking unless a separate existing verification or
  permission gate independently requires a reason.
- Commit after each coherent task group when implementation begins.
