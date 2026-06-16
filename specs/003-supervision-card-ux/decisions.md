# Supervision Card UX & IA Decision Log

**Date**: 2026-06-14
**Status**: Active presentation/IA authority
**Spec**: `specs/003-supervision-card-ux/spec.md`

## DEC-001: Presentation-Only — Flow Logic Is Untouched

- **Decision**: 003 changes supervision card presentation and information
  architecture only. The evidence computation in `decisionGatePolicy`, the
  `ApprovalJudgment` outcomes, and evidence-gated approval are unchanged.
- **Rationale**: A grounded code read showed the supervision *logic* already
  encodes the thesis (AI self-report is not verification; missing evidence forces
  a reason). The problem is presentation, not flow.
- **Implication**: 003 work must pass existing logic regression tests unchanged;
  any proposed flow change belongs in a separate spec, not here.

## DEC-002: The Criterion Question Is The Single Focal Element

- **Decision**: The review card's criterion-linked question is the dominant focal
  element; evidence, actions, and explanation are visually subordinate.
- **Rationale**: The pedagogical payload is criterion-linked verification. If the
  question is buried under metadata, the card stops teaching.
- **Implication**: Stacked prompt/message/explanation blocks are removed;
  explanation is at most one bounded line in Guided Mode.

## DEC-003: Review Cards Are Visually Distinct From Permission Cards

- **Decision**: Review (검토) cards must be visually distinguishable from
  permission/guard (allow/deny) cards, and a review card's primary affordance is
  a verification action, not a bare allow/deny choice.
- **Rationale**: Visual homogeneity across supervision surfaces causes card
  fatigue and reflexive approval — the automation bias DIVE counters.
- **Implication**: Shared `CardVisualLanguage` defines the distinction; an
  allow/deny button row must not be the review card's primary affordance.

## DEC-004: Progressive Disclosure, No Duplicated Controls

- **Decision**: The default card view uses minimal chrome (no default-open
  accordions, no multi-column metadata), and no control appears twice (no
  "선택할 수 있는 행동" bullet list duplicating buttons).
- **Rationale**: Redundant bullets-plus-buttons and stacked detail add reading
  load without decision value.
- **Implication**: Secondary detail moves behind on-demand disclosure.

## DEC-005: Content Caps Are Shared With specs/002

- **Decision**: specs/002 owns the content data caps (question/habit length,
  bounded evidence and action counts: FR-028/FR-029). specs/003 owns how that
  bounded content is laid out and which fields show per mode.
- **Rationale**: Keeping the data contract in 002 and the layout in 003 avoids
  overlapping authority and double-specification.
- **Implication**: 003 references 002 caps rather than redefining them; layout
  must not reintroduce content the caps removed.

## DEC-006: Single Card Tone For P1 (Caution)

- **Decision**: P1 review cards render a single visual tone (caution), not a
  per-evidence color split.
- **Rationale**: Multiple tones add visual noise and re-create the density the
  cleanup removes; the focal question, not color coding, carries the message.
- **Implication**: severity is fixed to `caution` in P1 (specs/002 FR-026); the
  003 layout does not branch tone by evidence state.

## DEC-007: 005 Status Cleanup Does Not Ship New Card UX

- **Decision**: The 005 conformance cleanup records the current 003 status
  without expanding card UX scope. Review-card presentation work already covered
  by existing implementation remains the baseline; full permission/guard-card
  harmonization under 003 FR-009 remains active/future unless a later UI slice
  validates it directly.
- **Rationale**: S-020 is a documentation truth pass, not a new presentation
  implementation. Overstating harmonization would recreate the spec-status drift
  that 005 is closing.
- **Implication**: Future agents may rely on 003 for presentation requirements,
  but must not treat every permission/guard-card harmonization item as shipped
  without concrete tests or a later status update.
