# PRD-Driven Decompose & Plan Lifecycle Decision Log

**Date**: 2026-06-14
**Status**: Active Planning
**Spec**: `specs/004-prd-decompose-lifecycle/spec.md`

## DEC-001: Interview Is Elevated To PRD Authoring — Required But Minimal

- **Decision**: The Socratic interview is elevated into the stage that authors a
  living PRD. It is required before the first decomposition, but "required" means
  a minimal viable PRD must exist, not that a long wizard must be completed.
- **Rationale**: Skipping it leaves nothing to decompose against; "spec before
  decompose" is the intended lesson. Keeping the minimum small protects
  constitution V (low-friction) and avoids the quiz/theater the constitution
  forbids. The PRD grows over time, including via mid-flow step additions.
- **Implication**: This resolves the `SocraticInterviewPanel` boundary concern by
  reframing it as real-project authoring, not a quiz.

## DEC-002: Decomposition Rationale Is Criterion-Linked And Challengeable

- **Decision**: Each step maps to PRD acceptance criteria (stable IDs) with a
  short rationale for why the work was split this way; the student can ask "why
  this step?" and raise an objection.
- **Rationale**: A generic AI rationale would teach students to trust plausible
  explanations. Tying the rationale to concrete criteria and letting the student
  challenge it makes it a supervision moment (criterion-linked verification).
- **Implication**: Generic, criterion-free rationale is unacceptable; the "이 단계
  왜?" affordance and objection path are first-class.

## DEC-003: Objection Logs And Suggests Re-Decomposition, Non-Blocking

- **Decision**: Raising an objection to a step rationale logs the objection and
  may trigger a non-blocking re-decomposition suggestion. It is never a hard gate.
- **Rationale**: The supervision-to-replanning loop is the point, but forcing it
  would violate low-friction.
- **Implication**: Objection -> log + optional re-decomposition flow; the student
  can always proceed.

## DEC-004: Step Add Is Low-Friction, In A Dedicated Area, Updates The PRD

- **Decision**: Steps are added mid-implementation from a dedicated plan area
  (not the chat), with one action; linking to a PRD criterion is encouraged but
  not forced. Adding a step updates the PRD and is logged; a step that expands
  scope beyond the PRD surfaces a non-blocking review card (specs/002).
- **Rationale**: Plan changes buried in chat are lost and unauditable
  (constitution II prefers contextual UI over chat). Low-friction keeps Work Mode
  light; scope-expansion supervision rides the existing review-card mechanism
  rather than a hard gate.
- **Implication**: A dedicated add-step surface is added to the plan area;
  `PlanMutation` is logged; PRD versioning reflects the change.

## DEC-005: PRD Is Student-Editable, Versioned, And Logged

- **Decision**: The PRD is editable by the student directly (AI may assist),
  versioned, and openable anytime; edits are logged for export.
- **Rationale**: The student owns the spec; supervision means the student can
  correct the AI's framing, not only consume it. Versioning and logging keep the
  research ledger intact.
- **Implication**: PRD edits are first-class events in the local log/export, with
  student PII masked (specs/002 FR-020).

## DEC-006: PRD Creation Uses A Dedicated Authoring Board, Not Chat Or Wizard

- **Decision**: The first PRD creation experience is a dedicated PRD Authoring
  Board with a compact header, left interview rail, right live editable PRD
  canvas, and persistent bottom action bar.
- **Rationale**: Ordinary chat hides the artifact and makes plan changes hard to
  audit; a wizard makes the work feel like a classroom form. A board keeps the
  real project artifact visible while preserving a short conversational
  interview.
- **Implication**: `SocraticInterviewPanel` is replaced/elevated into a board
  surface. Provider/model selection stays available. The primary create-plan
  action unlocks only after a minimal PRD exists.

## DEC-007: Onboarding Routes To PRD Before Session Or Plan Execution

- **Decision**: First-run onboarding changes from project/provider/session to
  project/provider/PRD/plan-or-session. When no minimal PRD exists, the current
  onboarding action opens the PRD Authoring Board.
- **Rationale**: DIVE's v2 lesson is "spec before decompose." If onboarding
  jumps from provider setup into a generic session, the PRD becomes optional and
  the decomposition has no durable source of truth.
- **Implication**: `GetStartedChecklist` and its model/controller need a PRD
  state. Existing PRD drafts resume in the board. Saved PRDs unlock plan
  generation/review; approved plans can continue to route into the roadmap.

## DEC-008: Interview Turns Produce Validated PRD Patches

- **Decision**: During PRD authoring, each interview turn may return a
  conversational response plus a structured `PrdPatch`. DIVE validates and
  merges accepted patches into the live PRD draft canvas. Official PRD versions
  are created only by the student's save action.
- **Rationale**: This makes the interview visibly productive: students see their
  answers become a project artifact in real time. Keeping patches as proposals
  preserves student ownership and prevents the LLM from silently becoming the
  source of truth.
- **Implication**: DIVE owns patch validation, merge rules, criterion ID
  assignment, conflict handling, EventLog/export records, and student override
  precedence. LLM patches cannot overwrite direct student edits without explicit
  acceptance.

## DEC-009: Completed PRD Uses A Separate Concise Read View

- **Decision**: After a PRD is saved, DIVE shows a separate Final PRD Read View
  by default instead of leaving the student inside the authoring board.
- **Rationale**: The authoring board needs interview context, patch state, and
  editable fields, which is too much information for reviewing the completed
  PRD. The completed state should be a quiet handoff artifact that makes the
  plan-generation decision easy.
- **Implication**: Authoring and reading are separate UI states. The read view
  prioritizes goal, acceptance criteria, scope boundaries, key constraints,
  version metadata, and next action. Editing reopens the authoring board.
