# PRD-Driven Decompose & Plan Lifecycle Decision Log

**Date**: 2026-06-14
**Status**: Active Draft
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
