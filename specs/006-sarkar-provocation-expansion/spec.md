# Feature Specification: Sarkar Provocation Expansion

**Feature Branch**: `codex/sarkar-provocation-expansion`

**Created**: 2026-06-16

**Status**: Draft

**Input**: User description: "Add the three additional Sarkar-style
provocation/review-card moments that are currently missing: plan draft approval,
diff-ready review, and retry-loop review. Do not force cards everywhere; keep
them evidence-grounded, non-blocking, contextual, and generated through the
SupervisorAgent path."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Question Weak Plan Drafts Before Approval (Priority: P1)

As a novice reviewing an AI-generated plan draft, when the plan is about to be
approved but important supervision material is weak or missing, DIVE shows one
nearby review card that asks a concrete question about the plan rather than
letting me approve by pattern-matching the button row.

**Why this priority**: Plan approval is the earliest decision point where a weak
plan can shape the whole implementation. A focused question here reinforces
Sarkar-style provocation without adding friction to execution.

**Independent Test**: Generate or load a plan draft with weak verification
coverage, missing acceptance-criterion linkage, or steps that appear too broad.
Before approval, verify that at most one contextual review card appears beside
the plan draft; with a well-scoped, evidence-covered plan, no card appears.

**Acceptance Scenarios**:

1. **Given** a plan draft has steps without clear verification coverage, **When**
   the student opens the plan approval surface, **Then** DIVE evaluates a
   plan-draft review event and may show one question near the plan draft.
2. **Given** a plan draft is well scoped, criterion-linked, and includes
   feasible verification, **When** the plan approval surface opens, **Then** no
   plan-draft review card is shown.
3. **Given** the supervisor is unavailable or returns an invalid decision,
   **When** the plan draft is reviewed, **Then** no static fallback card appears
   and the local ledger records the silent/drop outcome.

---

### User Story 2 - Challenge Suspicious Diffs Near The Changed Work (Priority: P2)

As a novice reviewing changed files after AI work, when the diff suggests
possible scope drift, unexpected high-risk files, or changes outside the
accepted plan, DIVE shows one nearby review card that asks whether those changes
belong to the current goal.

**Why this priority**: Diff review is where "it seems to work" can hide
unrelated changes. A question tied to actual changed files helps students
inspect the material instead of accepting the agent's summary.

**Independent Test**: Complete a step where changed files include an unexpected
or out-of-scope area. Verify that the diff-ready review card appears near the
diff or step-review surface, cites the concrete changed-file evidence, and does
not appear for expected files only.

**Acceptance Scenarios**:

1. **Given** changed files include a file outside the step's expected files or
   PRD scope, **When** the diff-ready review event is evaluated, **Then** DIVE
   may show one question near the diff or step-review surface.
2. **Given** changed files match the step and PRD evidence, **When** the same
   event is evaluated, **Then** DIVE stays silent.
3. **Given** a valid card is shown, **When** the student chooses an action,
   dismisses it, or marks it irrelevant, **Then** the response is locally
   logged with evidence correlation.

---

### User Story 3 - Interrupt Unproductive Retry Loops (Priority: P3)

As a novice encountering repeated failures, when the same failure pattern has
returned after repeated AI fixes, DIVE shows one nearby review card asking
whether to narrow the reproduction, inspect the last change, or recover instead
of asking for another blind fix.

**Why this priority**: Repeated retries can create cascading damage. This card
should appear only after concrete repeated-failure evidence exists, making it a
rare but high-value supervision prompt.

**Independent Test**: Produce the same terminal or verification failure at
least twice for the same step without a successful verification in between.
Verify that one retry-loop review card appears near the failure or recovery
surface; after a recovery/narrowing action or a new failure pattern, dedup and
evidence reset rules prevent stale repetition.

**Acceptance Scenarios**:

1. **Given** the same normalized failure recurs at least twice for one active
   step, **When** DIVE evaluates retry-loop review, **Then** it may show one
   question near the terminal, verification error, or recovery surface.
2. **Given** only one failure has occurred, **When** the failure is displayed,
   **Then** no retry-loop review card appears.
3. **Given** the student has already seen a retry-loop card for the same failure
   evidence, **When** the failure recurs without materially new evidence,
   **Then** DIVE does not show a duplicate card.

---

### User Story 4 - Audit Expanded Provocation Coverage (Priority: P4)

As a teacher-researcher, I can export a session and reconstruct which expanded
review events were evaluated, what evidence was available, whether a card was
shown or dropped, and how the student responded.

**Why this priority**: The feature is also a research instrument. Increasing
coverage must not reduce local auditability or blur shown cards, silent
decisions, and user responses.

**Independent Test**: Export a session containing one shown plan-draft card, one
silent diff-ready evaluation, and one dropped retry-loop decision. Confirm the
export distinguishes the event, artifact, evidence, validation outcome, and user
response where present.

**Acceptance Scenarios**:

1. **Given** an expanded review event is evaluated, **When** the session is
   exported, **Then** the export includes the event type, artifact reference,
   bounded evidence summary, validation outcome, and drop reason when present.
2. **Given** a student responds to a shown card, **When** the session is
   exported, **Then** the response is correlated with the supervisor evaluation.
3. **Given** evidence includes terminal or diff content, **When** it is logged or
   exported, **Then** secrets, credentials, and private environment dumps are
   absent.

### Edge Cases

- The plan draft is revised multiple times before approval.
- A plan draft has structural weaknesses but no concrete evidence refs can be
  created.
- A diff contains many files or large hunks that must be summarized.
- Changed files include generated, build, or lock files that may be noisy.
- A failure message changes superficially while representing the same failure
  pattern.
- A retry-loop card is shown, then the student performs a recovery action.
- The supervisor times out, returns malformed output, asks a non-question, or
  cites evidence that DIVE did not provide.
- Work Mode is active and several concerns are eligible at one decision point.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: DIVE MUST add three expanded review events: `plan_drafted`,
  `diff_ready`, and `retry_loop`.
- **FR-002**: Expanded review events MUST use the dedicated SupervisorAgent
  review path defined by the active provocation supervisor spec. Frontend
  keyword/list rule generation MUST NOT become a shipped fallback path.
- **FR-003**: DIVE MUST evaluate expanded review events only at real workflow
  decision points: plan draft approval, changed-work review, and repeated
  failure/recovery review.
- **FR-004**: A valid expanded review card MUST appear near the relevant
  artifact, not as an ordinary chat message.
- **FR-005**: A valid expanded review card MUST be non-blocking. Existing
  approval, verification, permission, or recovery gates may still enforce their
  own independent rules.
- **FR-006**: DIVE MUST stay silent when it cannot provide concrete evidence
  refs for the event.
- **FR-007**: DIVE MUST show at most one expanded review card for a single
  decision point.
- **FR-008**: DIVE MUST deduplicate expanded review cards by artifact, concern,
  and evidence identity so the same question does not repeatedly appear without
  materially new evidence.
- **FR-009**: Expanded review cards MUST ask a question. Non-question output
  MUST be dropped and logged.
- **FR-010**: Expanded review cards MUST cite only DIVE-provided evidence refs.
  Unknown, empty, malformed, or inconsistent evidence refs MUST cause the
  decision to be dropped.
- **FR-011**: Supervisor unavailable, timeout, malformed output, duplicate
  output, invalid evidence, or invalid action suggestions MUST result in no
  card plus a local log entry. Static fallback cards are prohibited.
- **FR-012**: The plan-drafted event MUST be eligible only while a plan draft is
  awaiting approval or revision, not after the plan has already been approved.
- **FR-013**: The plan-drafted event MUST be grounded in plan evidence such as
  goals, steps, acceptance criteria, verification coverage, criterion linkage,
  dependencies, and plan revision history.
- **FR-014**: Plan-drafted cards SHOULD focus on whether the plan can be judged
  and verified, not on generic quality advice.
- **FR-015**: The diff-ready event MUST be eligible only when DIVE has changed
  work for the active step and can compare it to the goal, plan, expected files,
  PRD scope, or prior changed-file evidence.
- **FR-016**: Diff-ready cards SHOULD focus on concrete scope drift, unexpected
  high-risk areas, or out-of-goal changes. DIVE MUST NOT show a diff-ready card
  solely because any file changed.
- **FR-017**: Diff-ready card actions MUST route to material inspection or
  recovery-oriented work, such as reviewing changed files, opening the relevant
  step, requesting explanation, or starting recovery. They MUST NOT offer a bare
  approve/proceed action.
- **FR-018**: The retry-loop event MUST be eligible only after the same
  normalized failure pattern recurs at least twice for the same active step
  without successful verification in between.
- **FR-019**: Retry-loop cards SHOULD focus on narrowing the failure, inspecting
  the last change, using recovery, or changing the plan, not on asking the AI to
  try again blindly.
- **FR-020**: A recovery, rollback, plan-adjustment, or materially different
  failure pattern MUST reset or change retry-loop evidence so stale cards do not
  keep appearing.
- **FR-021**: Work Mode MUST remain low-friction: expanded cards should be sparse,
  concise, dismissible or markable as irrelevant when not risk-severity, and
  never require long-form reflection.
- **FR-022**: Guided Mode MAY add one short explanation line, but the focal
  question remains the main content.
- **FR-023**: Student-facing Korean labels MUST continue to prefer "검토 카드" or
  "확인 필요 카드"; "도발카드" MUST NOT be the main user-facing label.
- **FR-024**: DIVE MUST preserve the existing add-step `scope_expansion` and
  verification `verify_entered` behavior; this feature expands coverage without
  weakening those paths.
- **FR-025**: Expanded event evaluation and card responses MUST be locally
  logged/exportable with event type, artifact reference, evidence references,
  validation outcome, drop reason when applicable, card id when shown, and
  user response when available.
- **FR-026**: Logs and exports MUST separate AI self-report, supervisor output,
  and concrete verification evidence.
- **FR-027**: Logs and exports MUST avoid raw secrets, OAuth tokens, API keys,
  private environment dumps, and unnecessary raw code or terminal bodies.
- **FR-028**: The feature MUST NOT introduce quizzes, flashcards, badges,
  scores, standalone card decks, generic worksheets, generic AI warning banners,
  legacy runtime fallback, static provocation fallback, or AI
  self-report-as-verification behavior.

### Key Entities

- **Expanded Review Event**: A lifecycle moment where DIVE may ask the
  SupervisorAgent to critique evidence for `plan_drafted`, `diff_ready`, or
  `retry_loop`.
- **Review Artifact**: The concrete plan draft, changed-work set, failure
  evidence, terminal result, verification result, or recovery context near which
  a card can appear.
- **Evidence Ref**: A DIVE-assigned reference to bounded project state used to
  justify the review event and any shown question.
- **Supervisor Decision**: The structured supervisor output that DIVE validates
  before any student-facing card appears.
- **Expanded Review Card**: The student-facing card rendered only after a valid
  supervisor decision passes evidence, question-shape, action, dedup, and
  logging rules.
- **Review Response**: The student's action, dismiss, mark-irrelevant, recovery
  choice, or material-inspection action associated with a shown card.

## DIVE v2 Boundaries *(mandatory)*

### Workflow Fit

This feature strengthens real project work inside Decompose, Instruct, Execute,
Verify, and Extend by adding sparse questions at three decision points where a
novice can otherwise accept AI output without inspecting the material:
approving a plan, accepting changed work, and retrying the same failure.

### Evidence Expectations

Plan-drafted cards must be grounded in the current plan draft, PRD goal,
acceptance criteria, verification coverage, criterion linkage, dependencies, or
revision history. Diff-ready cards must be grounded in changed files, diff
summaries, expected files, target files, PRD scope, or step goals. Retry-loop
cards must be grounded in repeated terminal or verification failure evidence,
retry count, last action, and recovery/rollback context. If those evidence refs
cannot be constructed, DIVE must stay silent and log no card.

### Non-Goals

- Do not re-enable shipped frontend keyword/list rule cards.
- Do not show review cards in ordinary chat as assistant messages.
- Do not add a generic always-on critic, background observer, or constant
  warning stream.
- Do not change the meaning of concrete verification evidence.
- Do not make plan approval, diff review, or retry recovery impossible when no
  card appears.
- Do not introduce quiz, flashcard, badge, score, standalone card-deck, generic
  worksheet, generic warning, legacy runtime fallback, static provocation
  fallback, or AI self-report-as-verification behavior.

### Research Ledger Expectations

Every expanded review evaluation must be locally exportable, including silent
and dropped outcomes. Shown card exposure, action, dismiss, and
mark-irrelevant responses must be correlated with the supervisor evaluation.
Exports must preserve enough bounded evidence metadata to reconstruct why a
card appeared or stayed silent without recording secrets or unnecessary raw
artifact bodies.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In validation scenarios, each of the three new decision points can
  produce exactly one contextual card when concrete triggering evidence exists.
- **SC-002**: In validation scenarios with adequate plan, expected diff, or
  single-failure evidence, the corresponding expanded event shows no card.
- **SC-003**: In malformed, unavailable, duplicate, unknown-evidence, and
  non-question supervisor-output scenarios, 100% of outcomes produce no
  student-facing fallback card and record a local drop/no-card result.
- **SC-004**: In a sample export containing all three expanded events, each
  event includes artifact identity, bounded evidence summary, validation
  outcome, and user response when a card was shown.
- **SC-005**: Manual review confirms expanded cards appear next to plan draft,
  diff/step review, or failure/recovery artifacts and never as ordinary chat
  messages.
- **SC-006**: Work Mode validation shows no more than one expanded review card
  per decision point and no mandatory long-form reflection for ordinary
  low-risk states.

## Assumptions

- The active provocation supervisor architecture from specs/002 remains the
  generation and validation authority for review cards.
- The active supervision card presentation spec from specs/003 remains the
  rendering authority for card hierarchy, labels, and density.
- The add-step scope-expansion path from specs/005 remains unchanged and is not
  reimplemented by this feature.
- Plan-drafted and diff-ready concerns may require supervisor judgment after
  DIVE creates bounded evidence; retry-loop eligibility requires deterministic
  repeated-failure evidence before supervisor review.
- Initial behavior should favor silence over noisy, weakly grounded cards.
