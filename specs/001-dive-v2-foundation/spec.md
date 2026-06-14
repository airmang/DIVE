# Feature Specification: DIVE v2 Foundation

**Feature Branch**: `001-dive-v2-foundation`

**Created**: 2026-06-14

**Status**: Draft

**Input**: User description: "Use GitHub spec-kit to confirm a firm DIVE v2
SPEC before implementation. Preserve the existing UI/UX baseline, make Pi
runtime the default foundation, remove legacy fallback decisions, introduce
LLM-based supervisor review cards, and separate supervision capability from the
core project workflow."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Confirm V2 Product Scope Before Build (Priority: P1)

As the product owner, the v2 scope can be reviewed as a concrete product
contract before any implementation begins, including what DIVE v2 is, what it
is not, what legacy behavior is removed, and which existing UI/UX behaviors are
preserved.

**Why this priority**: v2 only avoids v1-style drift if scope, non-goals, and
runtime assumptions are fixed before code is written.

**Independent Test**: A reviewer can read this spec, the constitution, and the
decision log and determine whether a proposed v2 task is allowed, out of scope,
or needs clarification.

**Acceptance Scenarios**:

1. **Given** a proposed feature that adds a quiz, badge, card deck, or generic
   warning banner, **When** it is checked against the v2 spec, **Then** it is
   rejected as out of scope.
2. **Given** a proposed feature that preserves the real project workflow and
   adds contextual evidence-backed supervision, **When** it is checked against
   the v2 spec, **Then** it can move to planning with explicit evidence and log
   requirements.
3. **Given** a proposed implementation task that keeps legacy runtime fallback,
   **When** it is checked against the v2 spec, **Then** it is rejected unless a
   future approved spec amends the constitution.

---

### User Story 2 - Novice Uses The Same DIVE Workflow With Cleaner Supervision (Priority: P2)

As a novice coding with AI, the v2 app still feels like DIVE: the primary work
is planning, instructing, executing, verifying, and extending a real project.
Review cards appear only when grounded in the current project state and help
the user decide what to inspect next.

**Why this priority**: v2 must preserve the product's learning value and UI/UX
continuity while removing internal clutter.

**Independent Test**: A realistic project session can be walked through from
goal to verification without encountering standalone lessons, quizzes, badges,
or unrelated card decks; every review card shown cites concrete evidence.

**Acceptance Scenarios**:

1. **Given** an AI claims a task is complete but no independent verification
   evidence exists, **When** the user reaches final approval, **Then** a nearby
   confirmation-needed card asks what evidence was observed and logs the
   exposure.
2. **Given** the user is approving a low-risk action with sufficient evidence,
   **When** no high-risk or unverified state exists, **Then** DIVE does not add
   extra reflection friction.
3. **Given** a review card is shown, **When** the user dismisses it or marks it
   irrelevant, **Then** the response is stored for local export.

---

### User Story 3 - Researcher Audits Supervision Events Later (Priority: P3)

As a teacher-researcher, the v2 app preserves a local, exportable trail of
workflow state, evidence, supervisor decisions, card exposure, and user
responses so pilot analysis can distinguish AI self-report from verified
evidence.

**Why this priority**: DIVE is both a product and a research instrument; a
supervision feature that cannot be audited is not acceptable for v2.

**Independent Test**: After a sample session, the export includes the workflow
timeline, review-card exposure, user response, evidence references, and
verification outcomes without exposing raw secrets.

**Acceptance Scenarios**:

1. **Given** a supervisor decision is evaluated, **When** it shows a card or is
   dropped, **Then** the local log records the event, summarized input context,
   decision, evidence references, and outcome.
2. **Given** a verification decision relies only on an AI claim, **When** the
   session is exported, **Then** that claim is labeled separately from
   observed verification evidence.
3. **Given** auth tokens or API keys exist in the runtime environment, **When**
   export is generated, **Then** raw secrets are excluded.

### Edge Cases

- A supervisor response has no evidence, is not phrased as a question, or
  duplicates a recent card for the same artifact; the system stays silent and
  logs the drop reason.
- A provider or runtime capability is unavailable in v2; the system shows an
  explicit setup or capability state instead of silently falling back to legacy
  execution.
- A user works in Guided Mode; explanations can be richer, but they remain
  attached to real project artifacts and do not become a separate lesson flow.
- A user works in Work Mode; review-card friction remains sparse and appears
  only for high-risk, ambiguous, or unverified evidence states.
- A proposed v1 feature has useful UI but coupled internals; v2 may preserve
  the visible behavior while rewriting the internal contract.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: DIVE v2 MUST be defined as a supervised AI coding workflow tool
  for novice users, not a quiz app, flashcard app, badge system, standalone
  card deck, or generic worksheet.
- **FR-002**: The primary v2 workflow MUST remain real project work through
  Decompose, Instruct, Execute, Verify, and Extend.
- **FR-003**: The existing DIVE UI/UX MUST be treated as the behavioral
  baseline unless a later approved spec explicitly changes a surface.
- **FR-004**: V2 MUST remove legacy runtime fallback as a product behavior;
  unavailable runtime or provider capabilities must be explicit user-visible
  states.
- **FR-005**: V2 MUST separate core project workflow from supervision
  capability so review cards and supervisor analysis annotate project work
  rather than becoming the main workflow.
- **FR-006**: Review cards MUST be grounded in concrete project state and MUST
  appear near the relevant goal, prompt, plan, permission, diff, terminal
  error, verification gate, or final approval.
- **FR-007**: Review cards MUST allow dismiss and mark-irrelevant actions and
  MUST log exposure plus user response through the local export path.
- **FR-008**: The system MUST NOT treat "AI said it is done" as verification
  evidence.
- **FR-009**: LLM-based supervisor decisions MUST be invoked only from
  deterministic workflow events and MUST be dropped when evidence is missing,
  malformed, duplicated, or not expressed as a question.
- **FR-010**: V2 MUST preserve local-first EventLog/exportability for workflow
  state, supervision events, evidence, user responses, and verification
  outcomes.
- **FR-011**: V2 MUST support Work Mode as low-friction by default and Guided
  Mode as more explanatory while still tied to real project artifacts.
- **FR-012**: V2 planning MUST classify every inherited v1 capability as keep,
  remove, or rewrite before implementation.

### Key Entities

- **ProjectWorkflow**: The user's real coding workflow, including goal, plan,
  active step, execution state, verification state, and extend/final approval.
- **EvidenceRecord**: A concrete observation such as a diff, terminal result,
  preview observation, verification log, permission decision, or user-observed
  state.
- **SupervisorDecision**: A structured decision from the supervisor agent,
  including question, concern, severity, and evidence references. Whether a card
  is shown or dropped (and the drop reason) is decided by DIVE validation, not by
  the agent.
- **ReviewCard**: A contextual UI annotation shown near a relevant artifact,
  with short actions, dismiss, mark-irrelevant, and logged response.
- **EventLogRecord**: A local audit record for workflow events, supervision
  decisions, evidence snapshots, card exposure, response, and export.
- **RuntimeCapabilityState**: A user-visible state describing whether the v2
  runtime can execute the requested work, without falling back to legacy
  behavior.
- **ExportBundle**: A local research artifact that reconstructs session
  timeline, evidence, supervisor interventions, and user responses.

## DIVE v2 Boundaries *(mandatory)*

### Workflow Fit

DIVE v2 supports real project work by preserving the Decompose -> Instruct ->
Execute -> Verify -> Extend workflow as the main experience. Supervision
surfaces are annotations on that workflow, not a replacement workflow.

### Evidence Expectations

Warnings, review cards, supervisor output, verification prompts, and final
approval prompts must cite concrete project state. The system must stay silent
or show an explicit unavailable state when the only basis is an AI claim,
missing context, duplicated concern, or unsupported runtime capability.

### Non-Goals

- V2 does not introduce quizzes, flashcards, scores, badges, fake practice
  tasks, standalone card decks, generic worksheets, or generic AI warning
  banners.
- V2 does not preserve legacy runtime fallback, static provocation fallback,
  keyword-generated review cards, or AI self-report-as-verification behavior.
- V2 does not start from implementation before product scope, runtime
  decisions, supervision contracts, and export expectations are specified.
- V2 does not claim proven improvement in supervision skill, metacognition,
  critical thinking, or AI overreliance unless supported by empirical data.

### Research Ledger Expectations

The local export must reconstruct which workflow event occurred, what evidence
was available, what the supervisor decided, whether a card was shown or
dropped, how the user responded, and how verification evidence differed from
AI self-report. Secret material must be excluded.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of v2 implementation specs include a Constitution Check
  before planning and tasks begin.
- **SC-002**: 100% of inherited v1 capabilities considered for v2 are labeled
  keep, remove, or rewrite before implementation starts.
- **SC-003**: In a sample project session, every shown review card references
  at least one concrete evidence record and is exported with exposure and user
  response.
- **SC-004**: In a sample project session, no standalone quiz, badge, card deck,
  generic worksheet, or generic warning banner appears in the primary workflow.
- **SC-005**: Runtime unavailability is represented as an explicit user-visible
  capability state in 100% of affected flows, with no silent legacy fallback.
- **SC-006**: Export from a sample session allows a reviewer to distinguish AI
  self-report from observed verification evidence for every final approval.

## Assumptions

- The first v2 decision artifact lives in the current repository so v1 history,
  audits, and UI references remain available while repo shape is still being
  decided.
- "Same UI/UX" means preserving visible behavior and interaction intent, not
  necessarily preserving old component boundaries, IPC payloads, or internal
  state structures.
- Product scope confirmation precedes the later decision between same-repo
  branch, monorepo v2 package, or separate repository.
- The v2 MVP will start with the highest-value supervision slice rather than
  porting every v1 feature at once.
