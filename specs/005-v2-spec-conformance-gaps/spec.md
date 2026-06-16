# Feature Specification: V2 Spec Conformance Gaps

**Feature Branch**: `005-v2-spec-conformance-gaps`

**Created**: 2026-06-15

**Status**: Implemented conformance cleanup (Wily S-016 through S-020)

**Input**: User description: "FR-023 말고도 아직 구현 안 한 active spec gap들을 작업 가능하게 정리한다. 새 005 feature로 남은 v2 conformance cleanup 범위를 만들고, spec -> plan -> tasks 순서로 진행한다."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - No Legacy Runtime Fallback (Priority: P1)

As a novice working in DIVE v2, when the selected provider or runtime cannot use
the supervised Pi execution boundary, DIVE clearly explains the capability
problem instead of silently routing the work through a legacy execution path.

**Why this priority**: The v2 foundation and constitution make Pi-only execution
the product boundary. Silent legacy routing is the highest-risk remaining
conformance gap because it weakens every supervision, permission, and export
claim.

**Independent Test**: Select a provider or runtime configuration without Pi
capability and attempt to start work. The session must not start through a
legacy runtime; instead the user sees an explicit unavailable/capability state,
and the local ledger records the blocked runtime decision.

**Acceptance Scenarios**:

1. **Given** a provider with confirmed Pi capability, **When** the student starts
   a DIVE work turn, **Then** the turn runs through the supervised v2 runtime and
   the runtime state names that supervised path.
2. **Given** a provider without confirmed Pi capability, **When** the student
   tries to start a work turn, **Then** DIVE blocks that turn with an explicit
   capability message and does not run the legacy loop.
3. **Given** a local configuration that requests legacy execution, **When** DIVE
   starts a v2 work turn, **Then** DIVE ignores or rejects that request as an
   unsupported v2 capability state rather than executing legacy behavior.

---

### User Story 2 - Scope Expansion Uses Supervisor Review Path (Priority: P1)

As a novice adding a step mid-implementation, if the new step appears to expand
the PRD scope, the review card near the add-step area is generated through the
same dedicated supervisor review path as other v2 review cards.

**Why this priority**: A hardcoded or frontend-authored scope card contradicts
the active review-card architecture. DIVE may deterministically detect the
scope concern, but the student-facing question must come from the dedicated
SupervisorAgent after DIVE validates evidence and feasibility.

**Independent Test**: Add a step whose evidence indicates possible scope
expansion. A non-blocking review card appears near the add-step area only after
DIVE creates bounded evidence, runs the supervisor review path, validates the
decision, and logs the evaluation; if the supervisor is unavailable or produces
an invalid decision, no static fallback card appears.

**Acceptance Scenarios**:

1. **Given** an add-step draft with no linked PRD criterion or a new scope area,
   **When** DIVE detects scope expansion, **Then** it evaluates a
   `scope_expansion` review event through the dedicated supervisor path before
   showing any student-facing card.
2. **Given** the supervisor returns invalid, duplicate, malformed, or unavailable
   output for the scope event, **When** validation completes, **Then** DIVE logs
   the outcome and shows no fallback card.
3. **Given** a valid scope-expansion decision, **When** the card renders, **Then**
   it is non-blocking, appears near the add-step area, cites concrete add-step
   and PRD evidence, and offers short immediate actions.

---

### User Story 3 - Rationale Challenge Offers Next Action (Priority: P2)

As a novice reviewing a decomposition step, when I challenge why a step exists,
DIVE records the objection and offers a non-blocking way to revisit the plan
without blocking execution.

**Why this priority**: The current challenge affordance records the student's
objection, but the success criteria require a visible re-decomposition offer.
The offer is part of the learning loop: the plan is challengeable, but ordinary
progress remains low-friction.

**Independent Test**: Challenge a step rationale from the step detail surface.
The objection is logged/exportable, the current step remains executable, and
the student receives a visible non-blocking suggestion or action to request a
plan adjustment.

**Acceptance Scenarios**:

1. **Given** a step with linked PRD criteria and a rationale, **When** the student
   submits an objection, **Then** DIVE records the objection with linked criteria
   and shows a non-blocking re-decomposition or plan-adjustment offer.
2. **Given** the student dismisses or ignores the offer, **When** they continue
   the current step, **Then** execution is not blocked solely because an
   objection was raised.
3. **Given** the student accepts the offer, **When** DIVE proposes a plan
   adjustment, **Then** the proposal remains a reviewable suggestion until the
   student confirms a plan mutation in the dedicated plan area.

---

### User Story 4 - Active Specs Tell The Truth (Priority: P3)

As the product owner, the active specs and status ledger accurately distinguish
implemented behavior, future scope, and partial conformance, so future agents do
not treat a checked-off task list as stronger evidence than the product state.

**Why this priority**: Several remaining gaps are not purely code gaps; they are
spec-status ambiguity. If active specs claim support for behavior that is only
reserved in data contracts or planned for later, future implementation work will
drift.

**Independent Test**: Review the canonical spec index and status ledger after
this feature. They identify this cleanup feature, state which older specs it
closes or clarifies, and do not mark future-only behavior as shipped.

**Acceptance Scenarios**:

1. **Given** the cleanup feature is complete, **When** an agent reads the active
   spec status, **Then** it can tell which v2 runtime, review-card, PRD lifecycle,
   and card-UX gaps are closed.
2. **Given** a reserved plan-mutation type has no user-visible mutation path,
   **When** active docs describe it, **Then** they label it as future/contract
   reserve rather than shipped behavior.
3. **Given** supervision card presentation cleanup is partially complete,
   **When** active docs summarize the state, **Then** they distinguish completed
   review-card/permission-card presentation work from any remaining harmonization.

### Edge Cases

- A provider previously supported only by legacy execution is selected in an
  existing workspace.
- A local environment or saved preference still requests legacy execution.
- Scope-expansion evidence exists, but no feasible review action is currently
  available.
- The supervisor times out or returns a question that is not tied to the
  add-step/PRD evidence.
- A student challenges a rationale multiple times for the same step.
- A student accepts a re-decomposition offer while a step is already active.
- Existing exports contain older legacy/runtime or static-card records.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: DIVE v2 MUST NOT start, label, or complete a user-visible work turn
  through a legacy runtime fallback.
- **FR-002**: Unsupported providers, missing Pi capability, missing credentials,
  or legacy runtime requests MUST appear as explicit setup/capability states
  before work begins.
- **FR-003**: Runtime selection records MUST be locally logged/exportable and
  distinguish successful supervised execution from blocked/unavailable runtime
  states.
- **FR-004**: DIVE MUST keep the deterministic scope-expansion detector for
  add-step drafts, but it MUST NOT directly author the student-facing review-card
  question.
- **FR-005**: Scope-expansion review cards MUST be evaluated through the
  dedicated SupervisorAgent path, using DIVE-owned evidence refs and validation
  before rendering.
- **FR-006**: Scope-expansion supervisor failure, timeout, malformed output,
  invalid evidence, duplicate decision, or unavailable runtime MUST result in no
  card plus local log; static fallback cards are prohibited.
- **FR-007**: A valid scope-expansion card MUST be non-blocking, appear near the
  dedicated add-step area, cite concrete PRD/add-step evidence, and offer only
  short immediate actions.
- **FR-008**: Rationale objections MUST remain local-first logged/exportable with
  linked step and PRD criterion context.
- **FR-009**: After a rationale objection, DIVE MUST offer a visible non-blocking
  re-decomposition or plan-adjustment next action.
- **FR-010**: Accepting a rationale-challenge offer MUST NOT silently mutate the
  plan; any resulting change remains a reviewable suggestion until confirmed in
  the dedicated plan area.
- **FR-011**: Existing reserved plan-mutation concepts without a user-visible path
  MUST be labeled as future or contract-reserved in active docs and status
  summaries.
- **FR-012**: Active spec status MUST be updated so future agents can identify
  which conformance gaps this feature closes, which older specs it clarifies,
  and which behavior remains future scope.
- **FR-013**: This cleanup MUST NOT introduce quizzes, scores, badges, standalone
  card decks, generic warning banners, static review-card fallback, provider
  fallback routing, or AI self-report-as-verification behavior.

### Key Entities

- **RuntimeCapabilityState**: User-visible state describing whether supervised
  v2 execution can proceed, why it is unavailable, and what setup action is
  required.
- **ScopeExpansionReviewEvent**: Deterministic add-step concern with PRD and
  add-step evidence refs that may be sent to the dedicated supervisor path.
- **RationaleObjection**: Student challenge to a step rationale, linked to step,
  PRD criteria, timestamp, and response status.
- **PlanAdjustmentOffer**: Non-blocking suggestion or action created after a
  rationale objection; accepting it leads to a reviewable plan change proposal.
- **SpecConformanceRecord**: Status entry that links the cleanup result to the
  active specs it closes or clarifies.

## DIVE v2 Boundaries *(mandatory)*

### Workflow Fit

This feature keeps DIVE inside the real Decompose, Instruct, Execute, Verify,
and Extend workflow. It removes a runtime ambiguity before execution, repairs a
review-card path around adding steps during planning/verification, and makes
step rationales genuinely challengeable inside the plan workflow.

### Evidence Expectations

Runtime capability states must be grounded in provider configuration, credential
state, and Pi capability. Scope-expansion cards must be grounded in PRD scope,
acceptance criteria links, add-step fields, and deterministic reason codes.
Rationale-challenge offers must be grounded in the challenged step, its linked
criteria, and the student's objection. When those evidence records are missing,
malformed, duplicated, or not actionable, DIVE must stay silent or show an
explicit unavailable state rather than generic AI warnings.

### Non-Goals

- No new standalone lesson, quiz, score, badge, flashcard, worksheet, or card
  deck flow.
- No change to ordinary low-risk approval friction beyond removing legacy
  fallback and repairing evidence-backed review paths.
- No user-visible legacy runtime fallback, static provocation fallback,
  keyword-generated review card, or provider fallback routing.
- No automatic plan mutation from chat or from a rationale objection without
  dedicated plan-area confirmation.
- No claim of measured improvement in supervision skill, metacognition,
  critical thinking, or AI overreliance.

### Research Ledger Expectations

The local ledger/export must reconstruct runtime capability decisions,
scope-expansion supervisor evaluations, shown/dropped/no-card outcomes, review
card exposure and responses, rationale objections, accepted/dismissed
plan-adjustment offers, and spec-status handoff notes. Raw secrets, provider
tokens, private environment dumps, and student PII must be masked or omitted.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In validation scenarios, 100% of unsupported or legacy-requested
  runtime starts are blocked with an explicit capability state and 0 legacy work
  turns begin.
- **SC-002**: In scope-expansion validation, 100% of shown add-step review cards
  have supervisor evaluation logs and 0 cards are generated by static fallback
  when the supervisor result is missing or invalid.
- **SC-003**: In rationale-challenge validation, 100% of submitted objections are
  logged/exportable and present a non-blocking plan-adjustment offer.
- **SC-004**: In regression validation, accepting or ignoring a
  rationale-challenge offer never blocks current-step execution by itself.
- **SC-005**: In status-document validation, the canonical spec index and status
  ledger identify all gaps closed by this feature and label future-only mutation
  behavior as not shipped.
- **SC-006**: In export validation, runtime capability decisions, supervisor
  evaluation outcomes, scope evidence, objections, and offer responses are
  reconstructable without raw secrets or unmasked student PII.

## Assumptions

- The current repository remains the implementation home.
- Existing DIVE UI/UX remains the baseline unless this feature explicitly
  changes a conformance gap.
- Scope-expansion detection remains deterministic and DIVE-owned; only the
  student-facing review question and suggested actions move through the
  supervisor review path.
- Step add remains the only required plan-mutation implementation in this
  cleanup; change-step and retire-step are treated as future/contract-reserved
  unless a later spec makes them user-visible requirements.
- Supervision-card presentation cleanup already completed in older work should
  be documented accurately rather than reimplemented unless validation finds a
  concrete regression.
