# Tasks: V2 Spec Conformance Gaps

**Input**: Design documents from `specs/005-v2-spec-conformance-gaps/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`,
`contracts/`, and `quickstart.md`

**Tests**: Tests are required for this DIVE v2 cleanup because it changes the
runtime boundary, supervisor review-card path, deterministic workflow events,
EventLog/export records, and canonical spec status.

**Organization**: Tasks are grouped by user story so each story can be
implemented and validated independently after the shared foundation.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish shared copy/type surfaces and make the cleanup visible to
the project before behavior changes begin.

- [x] T001 [P] Add runtime capability, scope-expansion supervisor, rationale offer, and spec-conformance copy keys in `dive/src/i18n/ko.json`
- [x] T002 [P] Mirror runtime capability, scope-expansion supervisor, rationale offer, and spec-conformance copy keys in `dive/src/i18n/en.json`
- [x] T003 [P] Add frontend RuntimeCapabilityState, ScopeExpansionSupervisorEvent, RationaleChallengeOffer, and SpecConformanceRecord TypeScript contracts in `dive/src/features/provocation/types.ts`
- [x] T004 [P] Add Rust runtime capability and plan-adjustment offer structs/enums in `dive/src-tauri/src/db/models.rs`
- [x] T005 [P] Add 005 feature notes to the active spec index in `specs/README.md`
- [x] T006 [P] Add 005 planning status to the canonical status ledger in `docs/spec-status.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Add deterministic contracts, EventLog/export helpers, and shared
test scaffolding that all user stories depend on.

**Critical**: No user-story implementation should begin until this phase is
complete.

- [x] T007 [P] Add Rust tests for runtime capability state serialization and unavailable reason codes in `dive/src-tauri/src/ipc/tests.rs`
- [x] T008 [P] Add Rust supervisor tests for `scope_expansion` event parsing, evidence validation, dedup identity, action filtering, and no-card drop reasons in `dive/src-tauri/src/dive/supervisor.rs`
- [x] T009 [P] Add EventLog payload tests for runtime capability, scope supervisor evaluation, plan adjustment offered, accepted, and dismissed records in `dive/src-tauri/src/dive/event_log.rs`
- [x] T010 [P] Add export sanitizer tests for runtime capability, scope supervisor, rationale objection, and plan-adjustment payloads in `dive/src-tauri/tests/export_jsonl.rs`
- [x] T011 Add runtime capability EventLog payload builders in `dive/src-tauri/src/dive/event_log.rs`
- [x] T012 Add plan_adjustment_offered, plan_adjustment_accepted, and plan_adjustment_dismissed EventLog payload builders in `dive/src-tauri/src/dive/event_log.rs`
- [x] T013 Extend supervisor domain enums and validation contracts for a `scope_expansion` event in `dive/src-tauri/src/dive/supervisor.rs`
- [x] T014 Extend frontend supervisor adapters for scope-expansion evaluation request/response fields in `dive/src/features/provocation/adapters.ts`
- [x] T015 Extend local export reconstruction to include runtime capability and plan-adjustment offer records in `dive/src-tauri/src/workspace_plan/artifacts.rs`

**Checkpoint**: Shared runtime/supervisor/offer contracts are typed, logged, and
exportable before UI or runtime behavior depends on them.

---

## Phase 3: User Story 1 - No Legacy Runtime Fallback (Priority: P1) MVP

**Goal**: V2 work turns run only through supervised Pi runtime or stop with an
explicit capability state; legacy fallback is not user-visible.

**Independent Test**: Select a Pi-capable provider and confirm a supervised Pi
runtime turn can start; select or simulate an unsupported provider or legacy
override and confirm no work turn starts through `legacy_loop`, with a local
capability record explaining why.

### Tests for User Story 1

- [x] T016 [P] [US1] Replace legacy fallback expectations with unavailable capability expectations in `dive/src-tauri/src/ipc/tests.rs`
- [x] T017 [P] [US1] Add chat_send tests for unsupported provider, legacy override, missing credentials, and missing project root blocked states in `dive/src-tauri/tests/chat_runtime.rs`
- [x] T018 [P] [US1] Add frontend runtime state tests for supervised label and unavailable capability messaging in `dive/src/components/shell/RuntimeBadge.test.tsx`
- [x] T019 [P] [US1] Add useChatSession reducer tests proving `legacy_loop` is not rendered as a successful v2 runtime in `dive/src/hooks/useChatSession.test.ts`

### Implementation for User Story 1

- [x] T020 [US1] Replace `RuntimeChoice::Legacy` user-work selection with a blocked RuntimeCapabilityState in `dive/src-tauri/src/ipc/state.rs`
- [x] T021 [US1] Update runtime selection so legacy overrides and providers without Pi descriptors return unavailable capability states in `dive/src-tauri/src/ipc/chat.rs`
- [x] T022 [US1] Emit runtime capability EventLog records before rejecting unsupported or legacy-requested work turns in `dive/src-tauri/src/ipc/chat.rs`
- [x] T023 [US1] Update Pi provider parity comments and tests to describe unavailable capability instead of fallback in `dive/src-tauri/src/pi_sidecar/parity.rs`
- [x] T024 [US1] Update runtime-selected event handling and user-visible copy for blocked capability states in `dive/src/hooks/useChatSession.ts`
- [x] T025 [US1] Update RuntimeBadge to show supervised runtime only for ready Pi execution and explicit unavailable state copy otherwise in `dive/src/components/shell/RuntimeBadge.tsx`
- [x] T026 [US1] Remove or quarantine user-visible `legacy_loop` labels from runtime i18n strings in `dive/src/i18n/ko.json`
- [x] T027 [US1] Mirror removal/quarantine of user-visible `legacy_loop` labels in `dive/src/i18n/en.json`

**Checkpoint**: User Story 1 can ship as MVP: no user-visible v2 work turn uses
legacy fallback, and unsupported runtime states are explicit and exportable.

---

## Phase 4: User Story 2 - Scope Expansion Uses Supervisor Review Path (Priority: P1)

**Goal**: Add-step scope-expansion review cards are generated through the
dedicated SupervisorAgent path, not frontend rule-card generation.

**Independent Test**: Add a step with deterministic scope-expansion evidence.
The add-step panel requests a `scope_expansion` supervisor evaluation; valid
decisions render near the add-step area, while timeout/invalid/unavailable
results log no-card outcomes and never show a static fallback card.

### Tests for User Story 2

- [x] T028 [P] [US2] Add Rust tests for scope-expansion SupervisorContext construction from add-step evidence in `dive/src-tauri/src/dive/supervisor.rs`
- [x] T029 [P] [US2] Add Rust IPC tests for `provocation_agent_evaluate` with `scope_expansion` shown, dropped, timeout, and unavailable outcomes in `dive/src-tauri/src/ipc/provocation_agent.rs`
- [x] T030 [P] [US2] Add PlanAddStepPanel tests for supervisor-backed card placement, no static fallback, and non-blocking save in `dive/src/components/product/PlanAddStepPanel.test.tsx`
- [x] T031 [P] [US2] Update quarantined rule tests so scope-expansion rule-card generation is not a shipped add-step path in `dive/src/features/provocation/__tests__/rules.test.ts`
- [x] T032 [P] [US2] Add frontend adapter tests for `scope_expansion` evaluation request/response normalization in `dive/src/features/provocation/adapters.test.ts`

### Implementation for User Story 2

- [x] T033 [US2] Extend `provocation_agent_evaluate` request handling to accept `scope_expansion` artifact refs and add-step evidence in `dive/src-tauri/src/ipc/provocation_agent.rs`
- [x] T034 [US2] Build DIVE-owned scope-expansion evidence refs from PRD criteria, add-step fields, and scope assessment reason codes in `dive/src-tauri/src/dive/supervisor.rs`
- [x] T035 [US2] Map valid `scope_expansion` SupervisorDecision output into a non-blocking review card with capped evidence/actions in `dive/src-tauri/src/dive/supervisor.rs`
- [x] T036 [US2] Add frontend invoke support for scope-expansion supervisor evaluation in `dive/src/features/provocation/adapters.ts`
- [x] T037 [US2] Replace `scopeExpansionAssessmentRule` usage with supervisor evaluation state in `dive/src/components/product/PlanAddStepPanel.tsx`
- [x] T038 [US2] Keep deterministic scope assessment in the add-step flow while moving student-facing question generation out of `dive/src/components/product/PlanAddStepPanel.tsx`
- [x] T039 [US2] Update scope-expansion card actions to route to criterion-link/edit/split affordances without silent plan mutation in `dive/src/components/product/PlanAddStepPanel.tsx`
- [x] T040 [US2] Quarantine or remove shipped access to scope-expansion rule-card generation in `dive/src/features/provocation/rules.ts`
- [x] T041 [US2] Ensure scope-expansion supervisor evaluations and card exposure/action/dismiss responses carry correlation metadata in `dive/src/features/provocation/logging.ts`

**Checkpoint**: User Story 2 can ship after US1 with SupervisorAgent-backed,
evidence-grounded, non-blocking scope-expansion review cards and no static
fallback.

---

## Phase 5: User Story 3 - Rationale Challenge Offers Next Action (Priority: P2)

**Goal**: Challenging a decomposition rationale logs the objection and offers a
non-blocking plan-adjustment/re-decomposition next action without silently
mutating the plan.

**Independent Test**: Challenge a step rationale. DIVE logs the objection,
returns `suggestionStatus: "offered"`, shows a visible offer near the challenge
result, lets the user continue the current step, and routes accepted offers to
a reviewable plan-area suggestion.

### Tests for User Story 3

- [x] T042 [P] [US3] Update workspace plan IPC tests to expect `suggestion_status = offered`, offer ID, and plan_adjustment_offered EventLog payloads in `dive/src-tauri/tests/workspace_plan_ipc.rs`
- [x] T043 [P] [US3] Add DAO roundtrip tests for rationale objection offer status and optional offer metadata in `dive/src-tauri/tests/workspace_prd_lifecycle.rs`
- [x] T044 [P] [US3] Extend StepDetailSlideIn tests for visible offer, accept/dismiss controls, and non-blocking current-step controls in `dive/src/components/product/StepDetailSlideIn.test.tsx`
- [x] T045 [P] [US3] Extend usePlan hook tests for challengeStepRationale offer fields and refresh behavior in `dive/src/features/planning/usePlan.test.ts`

### Implementation for User Story 3

- [x] T046 [US3] Extend challenge-step output types with offerId, offerKind, and offer message in `dive/src/features/planning/types.ts`
- [x] T047 [US3] Extend Rust StepRationaleChallengeOutput and objection persistence to support offered plan-adjustment state in `dive/src-tauri/src/ipc/workspace_plan.rs`
- [x] T048 [US3] Persist or reconstruct offer metadata for objections without applying a plan mutation in `dive/src-tauri/src/db/dao/plan_mutation.rs`
- [x] T049 [US3] Emit plan_adjustment_offered when a valid rationale objection is recorded in `dive/src-tauri/src/ipc/workspace_plan.rs`
- [x] T050 [US3] Add plan-adjustment accepted/dismissed IPC or reuse a typed existing response path in `dive/src-tauri/src/ipc/workspace_plan.rs`
- [x] T051 [US3] Add usePlan methods for accepting and dismissing rationale challenge offers in `dive/src/features/planning/usePlan.ts`
- [x] T052 [US3] Render the non-blocking offer, accept, and dismiss controls near the rationale challenge result in `dive/src/components/product/StepDetailSlideIn.tsx`
- [x] T053 [US3] Route accepted rationale offers to a reviewable dedicated plan-area suggestion without appending/changing a step automatically in `dive/src/components/product/useProductShellController.ts`
- [x] T054 [US3] Export rationale objections and plan-adjustment offer responses in `dive/src-tauri/src/workspace_plan/artifacts.rs`

**Checkpoint**: User Story 3 can ship with challengeable decomposition that
offers a next action while preserving low-friction execution.

---

## Phase 6: User Story 4 - Active Specs Tell The Truth (Priority: P3)

**Goal**: Canonical specs/status docs accurately report closed gaps,
clarifications, and future/reserved behavior.

**Independent Test**: A future agent can read `.specify/memory/constitution.md`,
`specs/README.md`, `docs/spec-status.md`, and 001-005 specs and determine which
runtime, review-card, PRD lifecycle, mutation, and card-UX behavior is shipped,
planned, or reserved.

### Tests for User Story 4

- [x] T055 [P] [US4] Add a documentation consistency check or grep-based regression script for shipped-vs-future mutation wording in `specs/005-v2-spec-conformance-gaps/quickstart.md`
- [x] T056 [P] [US4] Add status-document assertions for 005 closed/clarified gaps in `dive/src-tauri/tests/spec_status_docs.rs`

### Implementation for User Story 4

- [x] T057 [US4] Update `specs/README.md` after implementation to mark 005 scope and closed gaps accurately
- [x] T058 [US4] Update `docs/spec-status.md` after implementation with final 005 status, validation commands, and remaining future/reserved items
- [x] T059 [US4] Clarify in `specs/004-prd-decompose-lifecycle/data-model.md` that `change_step` and `retire_step` remain future/contract-reserved unless separately implemented
- [x] T060 [US4] Clarify in `specs/004-prd-decompose-lifecycle/spec.md` or decisions that this cleanup only ships add-step mutation unless a visible change-step path is added
- [x] T061 [US4] Update `specs/003-supervision-card-ux/spec.md` or decisions with final presentation/harmonization status after validation
- [x] T062 [US4] Update `specs/005-v2-spec-conformance-gaps/quickstart.md` with exact final validation command results

**Checkpoint**: User Story 4 closes the documentation truth gap so future work
does not mistake reserved contracts or partial presentation cleanup for shipped
behavior.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final validation, cleanup, and handoff.

- [ ] T063 Run TypeScript typecheck with `pnpm typecheck` from `dive/package.json`
- [ ] T064 Run frontend unit tests with `pnpm test:unit` from `dive/package.json`
- [ ] T065 Run Rust tests with `cargo test` from `dive/src-tauri/Cargo.toml`
- [ ] T066 Run targeted supervisor tests with `cargo test supervisor` from `dive/src-tauri/Cargo.toml`
- [ ] T067 Run targeted Pi sidecar supervisor tests with `cargo test pi_sidecar_supervisor` from `dive/src-tauri/Cargo.toml`
- [ ] T068 Run the 005 quickstart scenarios for legacy runtime block, unsupported provider block, scope supervisor no-fallback, rationale challenge offer, and docs status in `specs/005-v2-spec-conformance-gaps/quickstart.md`
- [ ] T069 Remove obsolete comments or tests that describe user-visible legacy fallback in `dive/src-tauri/src/ipc/chat.rs`
- [ ] T070 Remove obsolete comments or tests that describe shipped static scope-expansion cards in `dive/src/features/provocation/rules.ts`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: No dependencies.
- **Phase 2 Foundational**: Depends on Phase 1 and blocks all user stories.
- **Phase 3 US1**: Depends on Phase 2 and is the MVP.
- **Phase 4 US2**: Depends on Phase 2; should follow US1 so supervisor runtime unavailable/no-card behavior is consistent.
- **Phase 5 US3**: Depends on Phase 2; can run after US1 but does not require US2.
- **Phase 6 US4**: Depends on the desired implementation stories being complete.
- **Phase 7 Polish**: Depends on all implemented stories.

### User Story Dependencies

- **US1 (P1)**: MVP; no dependencies after foundation.
- **US2 (P1)**: Requires supervisor domain foundation; benefits from US1 runtime unavailable semantics.
- **US3 (P2)**: Requires plan mutation/objection foundation; independent of scope card changes.
- **US4 (P3)**: Requires final implementation truth from US1-US3.

### Within Each User Story

- Write or update tests first and confirm they fail for missing behavior.
- Rust domain/IPC changes before frontend adapters.
- Frontend adapters before UI integration.
- EventLog/export updates before marking a story complete.
- Validate the story independently at its checkpoint before continuing.

## Parallel Opportunities

- T001-T006 can run in parallel.
- T007-T010 can run in parallel before T011-T015.
- US1 tests T016-T019 can run in parallel.
- US2 tests T028-T032 can run in parallel.
- US3 tests T042-T045 can run in parallel.
- US4 docs/status tasks T057-T062 should run after implementation truth is known, but T055-T056 can start earlier.
- UI tasks touching different components can run in parallel after hooks/types are updated.

## Parallel Example: User Story 1

```text
Task: "T016 [P] [US1] Replace legacy fallback expectations in dive/src-tauri/src/ipc/tests.rs"
Task: "T017 [P] [US1] Add chat_send blocked-state tests in dive/src-tauri/tests/chat_runtime.rs"
Task: "T018 [P] [US1] Add RuntimeBadge tests in dive/src/components/shell/RuntimeBadge.test.tsx"
Task: "T019 [P] [US1] Add useChatSession reducer tests in dive/src/hooks/useChatSession.test.ts"
```

## Parallel Example: User Story 2

```text
Task: "T028 [P] [US2] Add scope SupervisorContext tests in dive/src-tauri/src/dive/supervisor.rs"
Task: "T030 [P] [US2] Add PlanAddStepPanel tests in dive/src/components/product/PlanAddStepPanel.test.tsx"
Task: "T032 [P] [US2] Add supervisor adapter tests in dive/src/features/provocation/adapters.test.ts"
```

## Parallel Example: User Story 3

```text
Task: "T042 [P] [US3] Update workspace plan IPC tests in dive/src-tauri/tests/workspace_plan_ipc.rs"
Task: "T044 [P] [US3] Extend StepDetailSlideIn tests in dive/src/components/product/StepDetailSlideIn.test.tsx"
Task: "T045 [P] [US3] Extend usePlan tests in dive/src/features/planning/usePlan.test.ts"
```

## Implementation Strategy

### MVP First

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3 only.
3. Validate that no v2 work turn starts through legacy fallback and unsupported
   providers/legacy requests show explicit capability states.
4. Stop for review before implementing scope-expansion supervisor cards and
   rationale challenge offers.

### Incremental Delivery

1. US1: no legacy runtime fallback.
2. US2: add-step scope-expansion card through SupervisorAgent.
3. US3: rationale challenge plan-adjustment offer.
4. US4: truthful canonical status and future/reserved mutation clarification.
5. Polish: full regression commands and quickstart validation.

### Regression Guardrails

- Do not add legacy runtime fallback, provider fallback routing, Node-side file
  or process mutation, Pi built-in tools, Pi resource discovery, shell fallback,
  static review-card fallback, standalone card decks, generic warning banners,
  or AI self-report-as-verification behavior.
- Scope-expansion card questions must come from SupervisorAgent after DIVE owns
  the deterministic trigger and evidence.
- Rationale objections must not mutate plans outside the dedicated plan area.
- Work Mode remains low-friction; added friction must be tied to runtime
  capability or concrete scope-expansion evidence.
