# Feature Specification: PRD-Driven Decompose & Plan Lifecycle

**Feature Branch**: `004-prd-decompose-lifecycle`

**Created**: 2026-06-14

**Status**: Active Draft (scope + decisions captured; user stories/FRs to be
expanded after the interview and re-decompose mockups)

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
2. **Given** an authored PRD, **When** the student opens it later, **Then** it is
   present, versioned, and editable.

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
- **FR-007**: Adding or changing a step MUST update the PRD; a step that expands
  scope beyond the PRD MUST surface a non-blocking review card (reuses specs/002).
- **FR-008**: This feature MUST stay inside real project work — no separate
  lesson, quiz, score, or badge flow.
- **FR-009**: All lifecycle events (PRD authored/edited, step added/changed,
  objection raised) MUST be local-first logged/exportable (constitution IV), with
  student PII masked (specs/002 FR-020).

### Key Entities

- **ProjectSpec (PRD)**: goal, scenarios, acceptance criteria (with stable IDs),
  out-of-scope, version.
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

## Current Implementation Alignment *(mandatory)*

### Rewrite / Elevate

- `dive/src/components/product/SocraticInterviewPanel.tsx` — elevate into the
  PRD-authoring interview (resolves the specs/002 gap boundary check); confirm it
  is real-project authoring, not a quiz.

### Reuse

- `PlanDashboardPanel`, `PlanDraftApprovalScreen`, `StepDetailSlideIn`,
  `RoadmapPanel`, `PlanDraftDependencyMap` — for decomposition display and the
  dedicated add-step area.

### New

- Persistent PRD store with version/log; per-step rationale + criterion links;
  `PlanMutation` logging; non-blocking scope-expansion card via specs/002.

## Assumptions

- The current repository remains the implementation home.
- specs/002 owns review-card content/feasibility; specs/003 owns card
  presentation; specs/004 owns the PRD and plan lifecycle.
- This spec will be expanded after the interview and re-decompose mockups.
