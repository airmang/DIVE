# Feature Specification: PRD-Driven Decompose & Plan Lifecycle

**Feature Branch**: `004-prd-decompose-lifecycle`

**Created**: 2026-06-14

**Status**: Implemented with reserved follow-up scope (PRD authoring,
criterion-linked decomposition, rationale challenge, and dedicated add-step
paths are shipped; `change_step` and `retire_step` remain
future/contract-reserved until separately specified and implemented)

**Input**: User description: "Elevate the Socratic interview into a stage that
authors a living project spec (PRD). Decomposition must explain, per step, why the
work was split this way, linked to PRD criteria and challengeable by the student.
Add the ability to add steps mid-implementation in a dedicated area (not chat),
since verifying always reveals changes."

## Context And Why

This feature strengthens the D (Decompose) and I (Instruct) of DIVE by producing a
real artifact — a project spec / PRD — and making the decomposition explainable.
Each step links to PRD acceptance criteria and carries a short rationale the
student can challenge. The plan stays mutable: steps can be added mid-flow because
implementing and verifying always surface changes.

This positively resolves the `SocraticInterviewPanel` boundary concern raised in
specs/002 implementation-gap: the interview is not a quiz or classroom theater, it
is the real interview that authors the student's actual project spec.

The PRD creation stage is a dedicated **PRD Authoring Board**, not a normal chat
message sequence and not a long wizard. It keeps a short interview rail and a
live editable PRD canvas visible together, so the student can see the project
artifact being formed while still answering lightweight prompts.

The interview is turn-by-turn PRD authoring. On each interview turn, the LLM may
return a conversational response plus a structured `PrdPatch`. DIVE validates the
patch, assigns any stable acceptance-criterion IDs, and merges accepted changes
into the live PRD draft canvas. The official PRD version is created only when the
student saves.

Once saved, the completed PRD is shown in a separate **Final PRD Read View**.
This view is intentionally quieter than the authoring board: it removes the
interview rail, patch status, and draft-edit controls, and shows only the
project goal, acceptance criteria, scope boundaries, key constraints, version,
and next action. Editing reopens the PRD Authoring Board.

The first-run onboarding path must also change: after project and provider/model
setup, the current step becomes PRD authoring. A normal coding session or plan
generation should not be treated as the next onboarding milestone until the
minimal PRD exists.

Boundary note: specs/002 owns review-card content and feasibility; specs/003 owns
card presentation; specs/004 owns the PRD and plan lifecycle. This feature does
not change the verify/approval flow logic.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Interview Authors A Living PRD (Priority: P1)

As a novice starting a project, a short interview helps me state a goal and
acceptance criteria, producing a project spec (PRD) I can open and edit anytime.

**Why this priority**: Without a minimal spec there is nothing to decompose
against and nothing to explain the step split. "Spec before decompose" is the
intended lesson.

**Acceptance Scenarios**:

1. **Given** a new project, **When** the student tries to reach decomposition,
   **Then** a minimal PRD must exist first (required), produced by a short
   conversational interview, not a long wizard.
2. **Given** a new project without a PRD, **When** the PRD stage opens, **Then**
   the student sees the PRD Authoring Board with provider/model selection,
   interview prompts, live editable PRD fields, and a disabled create-plan action
   until the minimal PRD fields are valid.
3. **Given** project and provider/model setup are complete, **When** onboarding
   advances, **Then** the current onboarding step is PRD authoring, not a generic
   coding session.
4. **Given** the student answers an interview prompt, **When** the LLM returns a
   valid PRD patch, **Then** DIVE applies the patch to the live PRD draft canvas,
   highlights changed fields, and logs the proposed/applied patch without
   creating an official PRD version yet.
5. **Given** the student directly edits a PRD field, **When** a later LLM patch
   proposes a conflicting change, **Then** the student's edit wins unless the
   student explicitly accepts the patch for that field.
6. **Given** an authored PRD, **When** the student opens it later, **Then** it is
   present in a concise read view with version metadata and clear edit/create
   plan actions.

### User Story 2 - Criterion-Linked, Challengeable Decomposition (Priority: P1)

As a novice, when the work is split into steps, each step shows which PRD criteria
it satisfies and why it was split that way, and I can ask "why this step?".

**Acceptance Scenarios**:

1. **Given** a decomposition, **When** it renders, **Then** each step shows at
   least one linked acceptance-criterion ID and a short rationale.
2. **Given** a step rationale, **When** the student raises an objection, **Then**
   it is logged and a non-blocking re-decomposition suggestion may follow.

### User Story 3 - Add A Step Mid-Implementation (Priority: P2)

As a novice, when verifying reveals a needed change, I can add a step from a
dedicated plan area (not the chat), and the PRD updates.

**Acceptance Scenarios**:

1. **Given** an active plan, **When** the student adds a step from the dedicated
   area, **Then** it is added with one action, logged, and the PRD updates.
2. **Given** a new step that expands scope beyond the PRD, **When** it is added,
   **Then** a non-blocking review card surfaces (reuses specs/002 mechanism).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The kickoff interview MUST produce a minimal living PRD before the
  first decomposition. It MUST be short and conversational and MUST NOT become a
  quiz or long wizard (constitution I/V).
- **FR-002**: The PRD MUST be a persistent, versioned, openable-anytime artifact,
  editable by the student directly (AI may assist), with changes logged for
  export.
- **FR-003**: PRD acceptance criteria MUST carry stable IDs that steps reference.
- **FR-004**: Decomposition MUST attach, per step, the PRD criteria it satisfies
  and a short rationale for why the work was split this way (criterion-linked, not
  generic).
- **FR-005**: The student MUST be able to challenge a step's rationale; an
  objection MUST be logged and MAY trigger a non-blocking re-decomposition
  suggestion (no hard gate).
- **FR-006**: Steps MUST be addable mid-implementation from a dedicated plan area
  (not the chat), low-friction (one action; criterion link encouraged, not
  forced), and always logged.
- **FR-007**: Adding a step MUST update the PRD; any future visible
  change-step or retire-step path MUST do the same before it can be marked
  shipped. A step that expands scope beyond the PRD MUST surface a non-blocking
  review card (reuses specs/002).
- **FR-008**: This feature MUST stay inside real project work — no separate
  lesson, quiz, score, or badge flow.
- **FR-009**: All lifecycle events (PRD authored/edited, step added/changed,
  objection raised) MUST be local-first logged/exportable (constitution IV), with
  student PII masked (specs/002 FR-020).
- **FR-010**: The interview surface MUST expose provider/model selection — the
  same control available in normal chat. Current gap (deferred here, not patched
  on this soon-to-be-reworked surface): `ChatArea` renders the interview panel
  *instead of* `ChatInput` (`ChatArea.tsx` ~line 392), so the interview loses
  `RuntimeModelSelector` and the user cannot change the model during the first
  conversation. The reworked interview MUST restore model/provider selection.
- **FR-011**: The PRD creation UI MUST be a dedicated PRD Authoring Board with
  these visible regions: a compact board header, a left interview rail, a right
  live PRD canvas, and a persistent bottom action bar. It MUST NOT be presented
  as ordinary chat messages, a modal-only flow, a landing page, or a multi-step
  wizard.
- **FR-012**: The board header MUST show project/PRD state, provider/model
  selection, and access to the current PRD version. The primary action MUST be
  unavailable until the minimal PRD has a non-empty goal and at least one
  acceptance criterion.
- **FR-013**: The interview rail MUST keep prompts short and contextual. It MAY
  ask follow-up questions, but it MUST show no progress score, quiz language,
  badge, or classroom exercise framing.
- **FR-014**: The PRD canvas MUST expose editable fields for goal, intent
  summary, in-scope, out-of-scope, constraints, and acceptance criteria. The
  acceptance criteria MUST show stable criterion IDs once saved or generated.
- **FR-015**: Saving the PRD from the board MUST create or update the persistent
  PRD artifact, create a version/log entry, and then enable decomposition from
  that artifact without requiring the student to re-enter the same information
  in chat.
- **FR-016**: First-run onboarding MUST include PRD authoring as the required
  step after project setup and provider/model setup, before generic session
  start, plan generation, or step execution. Existing onboarding UI such as
  `GetStartedChecklist` MUST route the student into the PRD Authoring Board when
  no minimal PRD exists.
- **FR-017**: If a PRD draft already exists but is not saved as a minimal PRD,
  onboarding MUST restore the PRD Authoring Board in draft state rather than
  starting a fresh interview or opening normal chat.
- **FR-018**: If a minimal PRD exists but no plan exists, onboarding MUST route
  to plan generation/review from that PRD. If an approved plan exists, onboarding
  may route to the roadmap/next step as today.
- **FR-019**: Each interview turn MAY produce a structured `PrdPatch` alongside
  the conversational response. The patch MUST be treated as a proposal, not as
  an official PRD version.
- **FR-020**: DIVE MUST validate every `PrdPatch` before merging it into the
  live PRD draft. Validation MUST allow only known PRD fields, reject malformed
  or oversized changes, reject unsupported operations, and prevent raw secrets
  from entering the draft/log payload.
- **FR-021**: DIVE, not the LLM, MUST assign stable acceptance-criterion IDs.
  If an LLM patch proposes new criteria, DIVE assigns IDs during validation or
  merge.
- **FR-022**: The live PRD canvas MUST show which fields changed after an
  applied interview-turn patch. A rejected patch MUST leave the canvas unchanged
  and surface a compact, non-blocking explanation.
- **FR-023**: Student direct edits MUST take precedence over later LLM patches.
  Conflicting patch operations MUST be held as suggestions or dropped unless the
  student explicitly accepts them.
- **FR-024**: Interview-turn patches, validation outcomes, accepted field
  changes, rejected changes, and student overrides MUST be local-first
  logged/exportable without treating draft patches as official PRD versions.
- **FR-025**: After the student saves a minimal PRD, DIVE MUST show a separate
  Final PRD Read View by default. This view MUST NOT include the interview rail,
  patch log/status, live draft validation hints, or inline editing controls.
- **FR-026**: The Final PRD Read View MUST be concise: it MUST prioritize goal,
  acceptance criteria, scope/out-of-scope summary, key constraints, PRD version,
  and next action. Secondary details MAY be collapsed or hidden behind an edit
  action.
- **FR-027**: Editing a completed PRD MUST reopen the PRD Authoring Board or an
  equivalent edit mode with versioning; the read view itself remains optimized
  for review and plan handoff.

### Key Entities

- **ProjectSpec (PRD)**: goal, scenarios, acceptance criteria (with stable IDs),
  out-of-scope, version.
- **LiveProjectSpecDraft**: unsaved board state updated by student edits and
  validated interview-turn patches before official version creation.
- **InterviewTurn**: one student answer plus LLM response, optional `PrdPatch`,
  validation outcome, and applied/rejected changes.
- **PrdPatch**: bounded structured proposal to update known PRD fields.
- **DecompositionRationale**: per step, the linked criteria and why the work was
  split this way.
- **PlanMutation**: an add/change-step event with reason and the resulting PRD
  delta.
- **Objection**: a logged student challenge to a step rationale.

## DIVE v2 Boundaries *(mandatory)*

### Non-Goals

- No quiz, classroom theater, long wizard, score, or badge.
- No change to the verify/approval flow logic (owned by the existing
  decision/approval code and specs/001 boundaries).
- No claim of measured pedagogical improvement without empirical data.

### Research Ledger Expectations

The PRD, decomposition rationale, objections, and plan mutations must be
reconstructable from local export, with student PII masked.

## Success Criteria *(mandatory)*

- **SC-001**: A new project cannot reach decomposition without a minimal PRD.
- **SC-002**: Every step shows at least one linked acceptance criterion and a
  rationale.
- **SC-003**: An objection is logged and offers re-decomposition without blocking
  the student.
- **SC-004**: A step added mid-flow updates the PRD and is logged.
- **SC-005**: The interview is bounded (a small required-field set), not a long
  wizard.
- **SC-006**: In the PRD Authoring Board, the student can see and edit the PRD
  canvas while answering interview prompts, and provider/model selection remains
  available.
- **SC-007**: First-run onboarding shows PRD authoring as the next required step
  after project and provider/model setup, and it resumes an existing PRD draft
  instead of opening ordinary chat.
- **SC-008**: After each valid interview turn, the PRD canvas reflects the
  validated patch within the draft state, while official PRD version creation
  still requires the student's save action.
- **SC-009**: After saving, the completed PRD opens in a concise read view with
  no interview rail or patch controls, and the student can intentionally enter
  edit mode when needed.

## Current Implementation Alignment *(mandatory)*

### Rewrite / Elevate

- `dive/src/components/product/SocraticInterviewPanel.tsx` and its surrounding
  `ChatArea` integration — replace/elevate into a dedicated PRD Authoring Board
  (resolves the specs/002 gap boundary check); confirm it is real-project
  authoring, not a quiz. The new board MUST restore provider/model selection
  (FR-010) — today the interview omits the model selector because `ChatArea`
  swaps `ChatInput` for the interview panel.
- `dive/src/components/product/GetStartedChecklist.tsx` and the controller that
  builds its model — update first-run onboarding from `project -> provider ->
  session` to `project -> provider -> PRD -> plan/session`, restoring draft PRDs
  when present.

### Reuse

- `PlanDashboardPanel`, `PlanDraftApprovalScreen`, `StepDetailSlideIn`,
  `RoadmapPanel`, `PlanDraftDependencyMap` — for decomposition display and the
  dedicated add-step area.

### New

- Dedicated PRD Authoring Board surface with turn-by-turn PRD patching; separate
  concise Final PRD Read View; persistent PRD store with version/log; per-step
  rationale + criterion links; `PlanMutation` logging; non-blocking
  scope-expansion card via specs/002.

## Assumptions

- The current repository remains the implementation home.
- specs/002 owns review-card content/feasibility; specs/003 owns card
  presentation; specs/004 owns the PRD and plan lifecycle.
- The PRD Authoring Board UI contract is canonical for task generation. Future
  mockups may refine visual density, but they must preserve the board regions,
  state model, and low-friction PRD-first behavior defined here.
- The Final PRD Read View is the default completed-state surface. It may be
  visually refined later, but it must remain simpler than the authoring board.
- The LLM may help draft the PRD incrementally, but DIVE remains authoritative
  for patch validation, criterion IDs, merge policy, logging, and official PRD
  version creation.
- As clarified by `specs/005-v2-spec-conformance-gaps/`, `add_step` is the only
  shipped visible plan-mutation path from this feature. `change_step` and
  `retire_step` are future/contract-reserved and must not be treated as shipped
  until a later spec adds the visible path, tests, and EventLog/export coverage.
