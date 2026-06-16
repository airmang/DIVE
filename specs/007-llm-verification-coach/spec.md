# Feature Specification: LLM Verification Coach

**Feature Branch**: `codex/007-llm-verification-coach`

**Created**: 2026-06-16

**Status**: Draft

**Input**: User description: "During each step review, do not rely on a static
manual-verification card. Have an LLM inspect the current step context and guide
the novice through how to verify the step. The LLM can explain what to check,
but completion still requires user-observed evidence or other concrete
verification evidence."

## Context And Why

Step review currently assumes that DIVE already knows which verification action
to show. When a step has no preview, runnable app action, or test command, the
review panel can become silent or ambiguous. A novice then does not know whether
to run a terminal command, inspect a saved file, open a diff, ask for changes, or
approve with risk.

This feature makes review guidance adaptive. At the Verify decision point, DIVE
offers a contextual AI verification coach that reads the current goal, PRD
criterion, plan step, changed work, verification logs, and available execution
surfaces, then proposes concrete checks the student can perform. The coach is
not the approver. The student must still connect an observation, successful
test, or explicit risk decision before the step can be completed.

This feature is separate from Sarkar-style review cards. Review cards remain
governed by the SupervisorAgent specs. The verification coach helps the student
know how to verify; it does not add a new provocation-card moment and it does
not replace evidence gates.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Get Step-Specific Verification Guidance (Priority: P1)

As a novice in a step review, I can ask DIVE how to verify this exact step, and
the answer tells me what to run, inspect, or observe based on the work that was
actually produced.

**Why this priority**: This is the core unblocker. Without guidance, the student
cannot make an informed approval decision when no preview or test button exists.

**Independent Test**: Open review for a CLI/manual step with no preview action
and no automated test command. Verify that DIVE shows a verification-coach
surface with step-specific checks such as command execution, sample input,
expected output, and saved-file inspection instead of leaving the student with
only a disabled or unexplained approval path.

**Acceptance Scenarios**:

1. **Given** a step has an acceptance criterion and changed files but no preview
   action, **When** the student opens step review, **Then** DIVE offers a
   contextual verification guide for that step.
2. **Given** the current step is a CLI or file-output workflow, **When** the
   guide is generated, **Then** it describes terminal commands, example inputs,
   expected observable outputs, and any relevant file or diff checks.
3. **Given** the step has a runnable preview or automated tests, **When** the
   guide is generated, **Then** it can include those actions but must still state
   the acceptance criterion the student should observe.
4. **Given** the guide cannot confidently identify a verification path, **When**
   the review opens, **Then** DIVE states what evidence is missing and offers
   safe next actions such as inspect diff, ask for a verification command,
   record direct observation, or request changes.

---

### User Story 2 - Record User-Observed Evidence Before Approval (Priority: P1)

As a novice, after following the coach's guide, I can record what I observed and
connect it to the completion criterion before approving the step.

**Why this priority**: The feature must not turn AI advice into verification.
Approval should become easier because the student knows what to observe, not
because DIVE trusts the AI's self-report.

**Independent Test**: Follow a generated guide for a manual step, record a short
observation, mark the relevant completion criterion as observed, and verify that
the approval decision records user-observed evidence rather than AI self-report.

**Acceptance Scenarios**:

1. **Given** a verification guide is visible, **When** the student records an
   observation and confirms the criterion was met, **Then** DIVE treats the
   observation as concrete human evidence for the approval gate.
2. **Given** the student has not recorded an observation or successful test,
   **When** they attempt normal approval, **Then** DIVE must keep the approval
   gate evidence-aware and explain what is still missing.
3. **Given** the student approves despite incomplete evidence, **When** the step
   completes, **Then** the decision is recorded as risk accepted or verification
   deferred, not as verified with evidence.

---

### User Story 3 - Regenerate Or Refine Guidance As Evidence Changes (Priority: P2)

As a novice, if the first guide is unclear or the project state changes, I can
ask DIVE to update the verification guidance without restarting the step.

**Why this priority**: Verification often reveals missing commands, unexpected
files, or new failure output. The coach should adapt to the current material.

**Independent Test**: Generate guidance, then add a test result or changed-file
evidence and ask for updated guidance. Verify that the new guidance references
the newer evidence and does not discard prior user observations.

**Acceptance Scenarios**:

1. **Given** a guide was already generated, **When** the student asks for updated
   guidance, **Then** DIVE produces a new guide using the latest step state and
   keeps previous guide history exportable.
2. **Given** verification fails, **When** the student requests guidance again,
   **Then** DIVE suggests narrowing or reproducing the failure before another
   blind approval attempt.
3. **Given** the student recorded an observation, **When** guidance refreshes,
   **Then** the observation remains attached to the step review decision until
   the student clears or replaces it.

---

### User Story 4 - Audit Guidance, Evidence, And Decisions (Priority: P3)

As a teacher-researcher, I can export a session and reconstruct what guidance
was shown, what evidence the student recorded, and whether the final approval
was evidence-backed, risk accepted, deferred, or rejected.

**Why this priority**: DIVE's review flow is also a research instrument. The
new coaching layer must preserve the separation between AI guidance and student
verification evidence.

**Independent Test**: Complete one step with evidence-backed approval and one
step with risk acceptance after coach guidance. Export the session and confirm
that AI guidance, student observations, evidence status, and approval outcome
are distinguishable.

**Acceptance Scenarios**:

1. **Given** a verification guide is generated, **When** the session is
   exported, **Then** the export includes the guide event, bounded input
   summary, model identity, evidence references, and generated checklist or
   procedure summary.
2. **Given** a student records an observation, **When** the session is exported,
   **Then** the observation is correlated with the step, criterion, guide
   version, and final approval decision.
3. **Given** the guide includes terminal output, file names, or diff summaries,
   **When** the data is logged or exported, **Then** secrets and unnecessary raw
   code or private environment details are absent.

### Edge Cases

- The step has no acceptance criterion or the criterion is too vague to verify.
- The step has multiple acceptance criteria that require different checks.
- The project is CLI-only, file-output-only, library-only, or otherwise has no
  preview surface.
- The project has a preview, but the acceptance criterion cannot be verified by
  looking at the first screen.
- The AI claims work is done, but there are no changed files, test results, or
  user observations.
- Automated tests fail, but the student believes a manual acceptance path still
  works.
- A verification command is missing, stale, or unsafe to run.
- The guide is unavailable, times out, produces generic advice, or references
  evidence DIVE did not provide.
- Guidance changes after a plan step is edited or an additional step is added.
- A Sarkar review card and verification coach guidance are both eligible near
  the same review surface.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: DIVE MUST offer an AI verification coach from each step review
  surface when the student needs to decide whether a step is complete.
- **FR-002**: The verification coach MUST use current project evidence,
  including the step goal, PRD or plan acceptance criteria, step instruction,
  changed work summary, available verification commands, preview/app
  availability, prior verification logs, and previous user observations when
  present.
- **FR-003**: Coach guidance MUST explain the completion criterion first, then
  propose concrete checks the student can perform.
- **FR-004**: Coach guidance MUST adapt to the project shape. It MUST support
  at least preview observation, app run observation, terminal/CLI execution,
  file-output inspection, diff inspection, automated test execution, and manual
  scenario confirmation.
- **FR-005**: Coach guidance MUST appear near the step review and approval
  decision surface, not as an ordinary detached chat message.
- **FR-006**: The student MUST be able to request updated guidance while staying
  in the step review flow.
- **FR-007**: The student MUST be able to record a short observation describing
  what they saw or ran.
- **FR-008**: The student MUST be able to connect their observation to one or
  more completion criteria before normal evidence-backed approval is enabled.
- **FR-009**: A successful automated test or a criterion-linked user
  observation MUST count as concrete verification evidence.
- **FR-010**: Coach guidance, AI self-report, generic advice, or "the AI says it
  is done" MUST NOT count as concrete verification evidence.
- **FR-011**: If concrete evidence is missing, DIVE MUST keep normal approval
  blocked or clearly downgrade the outcome to risk acceptance or verification
  deferral, depending on the student's decision.
- **FR-012**: When no reliable verification path can be proposed, DIVE MUST
  explain the missing evidence and offer safe next actions without inventing
  confidence.
- **FR-013**: DIVE MUST not show an empty or ambiguous review surface solely
  because preview/app/test actions are unavailable.
- **FR-014**: Coach guidance MUST be concise in Work Mode and may include a
  short explanation in Guided Mode, while keeping the verification steps
  actionable.
- **FR-015**: DIVE MUST preserve existing SupervisorAgent review-card behavior.
  Verification coaching MUST NOT replace, suppress, or statically synthesize
  Sarkar-style review cards.
- **FR-016**: If a review card and coach guidance both appear, DIVE MUST make
  their roles visually distinct: the coach explains how to verify, while the
  review card asks a grounded supervision question.
- **FR-017**: DIVE MUST validate generated guidance before display. Guidance
  that is generic, non-actionable, unsupported by supplied evidence, unsafe, or
  inconsistent with the step criterion MUST be dropped or replaced with a
  bounded "guidance unavailable" state.
- **FR-018**: Dropped or unavailable guidance MUST NOT become a static
  provocation or generic warning fallback.
- **FR-019**: DIVE MUST log guidance generation, dropped guidance, student
  observations, criterion confirmations, approval outcome, and any risk or
  deferral reason through the local research ledger.
- **FR-020**: Logs and exports MUST separate AI guidance, AI self-report,
  student observation, automated test evidence, and final approval decision.
- **FR-021**: Logs and exports MUST avoid raw secrets, credentials, private
  environment dumps, and unnecessary raw code bodies.
- **FR-022**: Existing step completion, request-changes, recovery, and plan
  adjustment flows MUST continue to work when coaching is unavailable.
- **FR-023**: The feature MUST NOT introduce quizzes, flashcards, badges,
  scores, standalone card decks, generic worksheets, legacy runtime fallback,
  static provocation fallback, or AI self-report-as-verification behavior.

### Key Entities *(include if feature involves data)*

- **Verification Coaching Event**: A review-time event where DIVE asks for
  step-specific verification guidance using bounded project evidence.
- **Verification Guide**: The generated, validated guidance shown to the
  student. It includes the completion criterion, recommended checks, expected
  observations, and evidence capture prompts.
- **Observation Evidence**: A student-authored record of what they ran, saw, or
  inspected, optionally linked to one or more completion criteria.
- **Guidance Version**: A distinguishable instance of generated guidance for a
  step, used to correlate later observations and decisions.
- **Evidence-Backed Decision**: A final step decision whose approval state is
  based on concrete automated evidence or criterion-linked student observation.

## DIVE v2 Boundaries *(mandatory)*

### Workflow Fit

This feature supports the Verify phase of the real DIVE workflow. It helps the
student decide whether a concrete plan step is complete by turning the current
project state into actionable verification guidance. It also supports Extend
when verification reveals missing work, because unclear or failed verification
can route to request changes, recovery, or plan adjustment instead of blind
approval.

### Evidence Expectations

Guidance must be grounded in current project state: PRD criteria, plan step
metadata, step instruction, changed files, available run/test/preview surfaces,
verification logs, prior observations, and final approval context. DIVE must
stay cautious when these inputs are absent or contradictory. AI guidance itself
is not evidence; only automated results, user-observed criterion confirmation,
or explicit risk/deferral decisions affect completion state.

### Non-Goals

- This feature does not add new Sarkar/provocation review-card triggers; those
  remain governed by the SupervisorAgent review-card specs.
- This feature does not make the LLM the approver or tester of record.
- This feature does not require every project to have automated tests, previews,
  or a runnable GUI.
- This feature does not implement broad plan mutation, change-step, or
  retire-step behavior.
- This feature does not introduce quiz, flashcard, badge, standalone card-deck,
  generic worksheet, generic warning, legacy runtime fallback, static
  provocation fallback, or AI self-report-as-verification behavior.

### Research Ledger Expectations

The local ledger must record each guidance request, available evidence summary,
validation outcome, displayed guide version, dropped/unavailable reason, student
observation, criterion confirmation, approval outcome, risk reason, deferral
reason, and request-changes decision. Export must allow later analysis to
distinguish "coach suggested this check" from "student observed this evidence"
and "step was approved with verified evidence."

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In at least 10 representative step-review fixtures covering GUI,
  CLI, file-output, library, testable, and no-test steps, the review surface
  presents a clear next verification action or a clear unavailable-guidance
  explanation in every case.
- **SC-002**: For a CLI/manual step with no preview and no test command, a
  novice evaluator can identify what to run or inspect within 15 seconds of
  opening review.
- **SC-003**: Normal approval is enabled only after an automated pass or a
  criterion-linked user observation in all evidence-gate acceptance tests.
- **SC-004**: Risk acceptance and verification deferral remain available and
  distinguishable when concrete evidence is missing.
- **SC-005**: Session export can reconstruct coach guidance, student
  observations, evidence status, and final approval outcome for every coached
  review decision in validation scenarios.
- **SC-006**: Guidance validation prevents display of generic or unsupported
  advice in all malformed/unavailable guidance tests.

## Assumptions

- The primary user is a novice working inside an active DIVE plan step.
- The existing step review panel remains the main approval surface.
- Existing PRD acceptance criteria and plan step metadata are the preferred
  source for completion criteria.
- The in-flight Sarkar provocation expansion remains separate; this feature may
  coexist with it but does not depend on it being merged first.
- Some projects will never have automated tests or previews, so user-observed
  criterion evidence is a first-class verification path.
