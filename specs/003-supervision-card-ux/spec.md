# Feature Specification: Supervision Card UX & Information Architecture

**Feature Branch**: `003-supervision-card-ux`

**Created**: 2026-06-14

**Status**: Active Draft

**Input**: User description: "The review/supervision cards carry too much text and
look cluttered. Clean up the card UI so the verification criterion is the focal
point and review cards are not confused with allow/deny permission cards. Do not
change the supervision flow logic — only the presentation."

## Context And Why

A grounded read of the current UI shows the supervision *flow logic* is sound:
`decisionGatePolicy.ts` already ties approval to concrete verification evidence
(missing evidence forces a reason), and `ApprovalJudgment.tsx` frames the moment
as "결과를 직접 확인했나요?" with a lean 확인함 / 우려 있음 path. The weakness is
*presentation*: supervision cards stack title + prompt + message + evidence chips
+ explanation, and permission/guard cards add redundant "선택할 수 있는 행동"
bullet lists (duplicating the buttons), multi-column metadata, badges, and default
accordions.

This is not only cosmetic. When a review (검토) card looks identical to an
allow/deny permission card, students reflexively approve — training the very
automation bias DIVE exists to counter. Density also buries the criterion-linked
question, which is the pedagogical payload (criterion-linked verification).

This feature changes presentation and information architecture only. It does not
change the SupervisorDecision contract (owned by specs/002) or the supervision
flow logic (decision gate, evidence-gated approval).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The Criterion Is The Focal Point (Priority: P1)

As a novice user, when a review card appears at verification, the one thing I see
first is a short criterion-linked question about my actual artifact, not a wall of
metadata.

**Why this priority**: The card's pedagogical value collapses if the question is
buried. The focal element must be the verification criterion.

**Independent Test**: Render a P1 `ai_self_report_only` card and confirm the
criterion-linked question is the single focal element, with at most a small,
visually subordinate set of evidence chips and actions, and no stacked
prompt/message/explanation blocks.

**Acceptance Scenarios**:

1. **Given** a valid P1 review-card decision, **When** the card renders, **Then**
   the criterion-linked question is the primary focal element and no redundant
   secondary text block repeats it.
2. **Given** Work Mode, **When** the card renders, **Then** it shows the question,
   at most a bounded evidence set, and short actions, with no explanation
   paragraph.
3. **Given** Guided Mode, **When** the card renders, **Then** it MAY add exactly
   one short explanation line, still subordinate to the question.

---

### User Story 2 - Review Cards Are Not Confused With Permission Cards (Priority: P1)

As a novice user, I can tell a "did you verify this?" card apart from an
"allow/deny this tool?" card at a glance, so I do not rubber-stamp verification.

**Why this priority**: Visual homogeneity across supervision surfaces breeds card
fatigue and reflexive approval, which is automation bias.

**Independent Test**: A UI snapshot test shows the review card and the
permission/guard card use distinct, recognizable visual treatments (affordance,
labeling, icon, and primary-action framing).

**Acceptance Scenarios**:

1. **Given** a review card and a permission card on screen, **When** compared,
   **Then** they are visually distinguishable and do not share an identical
   allow/deny button row as their primary affordance.
2. **Given** a review card, **When** rendered, **Then** its primary affordance is
   a verification action (inspect evidence / answer the question), not a bare
   allow/deny choice.

---

### User Story 3 - No Redundant Or Stacked Chrome (Priority: P2)

As a novice user, each control and fact appears once, and extra detail is
available on demand rather than stacked by default.

**Why this priority**: Redundant bullet-lists-plus-buttons and default accordions
add reading load without decision value.

**Independent Test**: Render a permission/decision card and confirm no control is
shown both as a descriptive bullet and as a button, and that detail panels are
collapsed by default (progressive disclosure).

**Acceptance Scenarios**:

1. **Given** a supervision card with actions, **When** rendered, **Then** each
   action appears exactly once as an actionable control (no parallel "선택할 수
   있는 행동" bullet list).
2. **Given** secondary detail (paths, raw metadata), **When** the card renders,
   **Then** that detail is behind progressive disclosure, not stacked in the
   default view.

### Edge Cases

- A decision provides more evidence/actions than the card cap (specs/002 FR-029):
  the card shows the highest-priority bounded set; the rest remain in the
  EventLog, not on the card.
- Guided Mode explanation would push the card past two screens of text: the
  explanation is the single bounded line; longer copy is not rendered.
- A permission/guard card cannot yet adopt the new visual language: it is tracked
  under harmonization (FR-009) and must not regress the review card's distinct
  treatment in the meantime.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The review (검토) card MUST present the criterion-linked question as
  the single focal element, visually dominant over evidence chips, actions, and
  any explanation.
- **FR-002**: Review cards MUST be visually distinguishable from permission/guard
  (allow/deny) cards. A review card's primary affordance MUST be a verification
  action, not a bare allow/deny choice.
- **FR-003**: A supervision card MUST NOT present the same control twice (for
  example, a "선택할 수 있는 행동" bullet list duplicating the action buttons).
  Each action appears once as an actionable control.
- **FR-004**: The default (collapsed) card MUST use minimal chrome: no default-open
  accordions, no multi-column metadata, and no more than the bounded evidence set.
  Secondary detail MUST use progressive disclosure (on demand).
- **FR-005**: Card density MUST be mode-aware. Work Mode renders question +
  bounded evidence + actions only. Guided Mode MAY add exactly one short
  explanation line. Neither mode stacks redundant prompt/message/explanation
  blocks. (Content caps are defined in specs/002 FR-028/FR-029.)
- **FR-006**: Supervision cards MUST preserve the constitution II/V properties:
  appear near the relevant artifact, offer short immediate actions, allow dismiss
  and mark-irrelevant, and stay sparse.
- **FR-007**: This feature MUST NOT change supervision flow logic. The evidence
  computation in `decisionGatePolicy`, the `ApprovalJudgment` outcomes, and the
  evidence-gated approval behavior are unchanged. Changes are presentation and
  information-architecture only.
- **FR-008**: Supervision cards MUST be accessible: fully keyboard operable,
  visible focus, and accessible names on all controls (the existing aria-labels
  are the seed, not the ceiling).
- **FR-009**: Permission/guard and decision cards SHOULD adopt the same visual
  language (focal action, no duplicated controls, progressive disclosure) for
  cross-surface consistency. Full permission-card redesign is tracked here as
  harmonization scope and may land after the review-card P1.

### Key Entities

- **SupervisionCardView**: The presentation contract for a supervision card
  (focal question, bounded evidence, bounded actions, optional one-line
  explanation, dismiss/mark-irrelevant), independent of how the decision was
  produced.
- **CardVisualLanguage**: The shared affordance/labeling/iconography that
  distinguishes review cards from permission/guard cards.

## DIVE v2 Boundaries *(mandatory)*

### Workflow Fit

Cards remain contextual annotations near the real artifact (verification/final
approval surface). This feature does not add a separate lesson, quiz, or
reflection flow, and does not move supervision out of the project workflow.

### Non-Goals

- No change to which evidence gates approval, or to any supervision flow logic
  (owned by specs/001 boundaries and the existing `decisionGatePolicy`).
- No change to the `SupervisorDecision` content contract (owned by specs/002).
- No new card types, scores, badges, quizzes, standalone card decks, or
  long-form reflection gates.
- No claim of measured pedagogical improvement without empirical data.

### Research Ledger Expectations

Evidence and actions beyond the card cap are not lost: they remain in the
EventLog/export per specs/002. Presentation changes MUST NOT reduce what is
logged for later analysis.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a sample session, a review card renders with the criterion-linked
  question as the single focal element, at most the specs/002 bounded evidence and
  action set, and no duplicated control.
- **SC-002**: A UI snapshot test confirms the review card and the permission/guard
  card are visually distinguishable.
- **SC-003**: No supervision card renders a default-open accordion, multi-column
  metadata, and a duplicated action list at the same time in the default view.
- **SC-004**: The card is fully keyboard operable and exposes accessible names for
  every control.
- **SC-005**: `decisionGatePolicy` and `ApprovalJudgment` behavior is unchanged
  (existing logic regression tests pass).

## Current Implementation Alignment *(mandatory)*

### Keep (logic — do not touch)

- `dive/src/components/product/decisionGatePolicy.ts` — evidence-gated approval
  logic is correct and pedagogically aligned.
- `dive/src/components/workmap/ApprovalJudgment.tsx` — lean, verification-framed
  judgment; keep behavior.
- Slide-in evidence tabs (`CodeTab`, `PreviewTab`, `TerminalTab`) — real artifacts
  for inspection.

### Rewrite (presentation)

- `dive/src/features/provocation/ProvocationCard.tsx` — establish focal hierarchy
  (question dominant), remove stacked prompt/message/explanation, apply bounded
  evidence/actions and progressive disclosure.
- Permission/decision card presentation (the MCP permission cards and
  `DecisionGate`) — remove redundant "선택할 수 있는 행동" bullets, collapse
  default multi-column metadata and accordions, adopt the shared visual language.
- The step-end review window/panel (`StepDetailSlideIn.tsx`, opened when a step
  finishes) — establish a clear verify -> judge -> approve hierarchy, lead with
  the criterion and the feasible verification method (specs/002 FR-030/FR-031),
  and use progressive disclosure for diff/detail instead of stacking everything in
  one dense view. When verification is infeasible, the forward path MUST be a
  clearly-labeled non-risk action, not the `위험 감수 승인` hatch (specs/002
  FR-032; see implementation-gap D3).

### Confirm

- `dive/src/components/product/SocraticInterviewPanel.tsx` — boundary check
  shared with specs/002 implementation-gap: confirm it is not a quiz/lesson flow
  before reusing it as a supervision surface.

## Assumptions

- The current repository remains the implementation home.
- specs/002 owns the decision/content contract; specs/003 owns presentation and
  information architecture; the supervision flow logic is owned by the existing
  evidence/approval code and is unchanged here.
- A lean review-card mockup will anchor the visual direction before broad
  component rewrites.
