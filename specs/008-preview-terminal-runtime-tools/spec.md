# Feature Specification: Preview And Terminal Runtime Tools

**Feature Branch**: `codex/008-preview-terminal-runtime-tools`

**Created**: 2026-06-17

**Status**: Draft

**Input**: User description: "Separate preview and terminal verification from
the generic project command tool. HTML/app preview should be a first-class safe
workflow, ordinary tests should keep using direct executable commands, and
shell-style terminal scripts should be handled only through a clearly bounded
high-risk path."

## Context And Why

DIVE currently has a supervised project command path that runs one executable
with explicit arguments. That is appropriate for simple checks such as running
a test command or build command, but it is the wrong product surface for
opening an HTML preview or running shell-style scripts.

The observed failure mode is concrete: when a student or AI needs to inspect an
`index.html` result, the AI may try to open the file through a platform shell
command. DIVE correctly treats this as high risk or invalid, but the user sees a
confusing approval card instead of a useful preview action. This creates a
false conflict between safe supervision and practical verification.

This feature defines separate runtime tools and user surfaces so DIVE can route
verification work correctly:

- preview work uses a dedicated Preview action;
- ordinary tests and builds use a direct Project Command action;
- shell-style terminal scripts, if needed, use a distinct high-risk Terminal
  Script action with stronger explanation, approval, logging, and blocking.

The goal is not to weaken supervision. The goal is to make each execution path
match the student's actual intent and make DIVE's approval cards truthful.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open Project Preview Without Shell Workarounds (Priority: P1)

As a novice reviewing a step, I can open a generated static HTML file, local
preview URL, or project dev preview through DIVE's Preview surface without
approving a shell command.

**Why this priority**: This fixes the immediate confusing flow. Previewing a
local result is verification work, not an arbitrary terminal command.

**Independent Test**: In a project containing a local `index.html`, ask DIVE to
show the result. Verify that DIVE opens the Preview surface or gives a clear
preview-specific error, and does not request approval for a shell command that
opens the file.

**Acceptance Scenarios**:

1. **Given** a project contains `index.html`, **When** the student asks to view
   the result, **Then** DIVE opens the file in the Preview surface without
   asking to run a platform shell.
2. **Given** a project has a running local preview URL, **When** the student
   asks to inspect it, **Then** DIVE connects the Preview surface to the local
   URL and records a preview event.
3. **Given** a project has a startable preview command, **When** the student
   chooses to open preview, **Then** DIVE starts or reuses the preview and
   displays the resulting local URL.
4. **Given** the requested file is not a previewable local project file,
   **When** the student asks to open it in Preview, **Then** DIVE explains why
   preview is unavailable and does not fall back to a shell command.

---

### User Story 2 - Keep Ordinary Verification Commands Simple (Priority: P1)

As a novice, I can approve a normal test or build command when DIVE needs to
verify work, and the approval explains exactly which executable and arguments
will run.

**Why this priority**: Most verification does not need shell syntax. Keeping the
simple command path narrow preserves low-friction supervision and clear
approval.

**Independent Test**: Ask DIVE to run a standard test command for a step. Verify
that the approval card shows one command, explicit arguments, expected risk, and
terminal output after execution.

**Acceptance Scenarios**:

1. **Given** a step has a direct verification command, **When** DIVE requests to
   run it, **Then** the approval card shows one executable and its arguments.
2. **Given** the command completes, **When** the result is available, **Then**
   DIVE records stdout, stderr, exit status, and a concise summary in the
   Terminal surface and local ledger.
3. **Given** the command request includes shell-only syntax, **When** DIVE
   evaluates it, **Then** DIVE rejects or reroutes it instead of silently
   treating it as a simple project command.

---

### User Story 3 - Reroute Invalid Preview Attempts Clearly (Priority: P2)

As a student, if the AI asks to use a risky command merely to open a preview,
DIVE blocks that command and offers the appropriate Preview action instead of
leaving a dead approval card.

**Why this priority**: Users should not have to debug tool policy. DIVE should
turn a common wrong tool choice into an understandable next action.

**Independent Test**: Trigger an AI request that attempts to open `index.html`
through a platform shell. Verify that DIVE closes the invalid command request,
explains that it did not run, and offers or opens the Preview path.

**Acceptance Scenarios**:

1. **Given** a command request is only trying to open a local HTML preview,
   **When** it is blocked, **Then** DIVE states that the shell command did not
   run and presents a Preview alternative.
2. **Given** an approval request is no longer active, **When** the student clicks
   allow or deny, **Then** DIVE visibly closes the stale request and explains
   that no command ran.
3. **Given** the preview alternative is unavailable, **When** DIVE blocks the
   command, **Then** DIVE explains the missing preview evidence and suggests a
   safe next step such as asking for a previewable file or running a direct
   verification command.

---

### User Story 4 - Run Shell-Style Terminal Scripts Only With Strong Guardrails (Priority: P3)

As an advanced student or instructor, when a verification task genuinely needs
shell syntax, I can approve a distinct Terminal Script action that makes the
full script, risk, and expected effect explicit.

**Why this priority**: Shell syntax is sometimes useful for multi-step
inspection, but it has a much larger risk surface than simple commands or
preview. It must not be smuggled into the ordinary command path.

**Independent Test**: Request a multi-command verification script. Verify that
DIVE presents it as a high-risk Terminal Script action, blocks known dangerous
patterns, never reuses approval automatically, and records the result separately
from simple command verification.

**Acceptance Scenarios**:

1. **Given** a script contains multiple commands for verification, **When** DIVE
   requests approval, **Then** the card shows the full script text, reason,
   expected effect, timeout, and output limits.
2. **Given** the script contains a known destructive or remote-execution
   pattern, **When** DIVE evaluates it, **Then** DIVE blocks it even if the
   student attempts to approve.
3. **Given** the script runs, **When** output is produced, **Then** DIVE displays
   bounded output in the Terminal surface and logs the execution as a Terminal
   Script event.
4. **Given** a script fails, **When** the student asks DIVE what happened,
   **Then** DIVE can explain the failure from captured output without implying
   that the step is verified.

### Edge Cases

- The requested static preview path is outside the project, missing, hidden by
  a symlink, or not an HTML file.
- The requested local URL is not local, uses an unsupported scheme, or fails to
  load.
- A project has both a static HTML file and a dev preview; DIVE must choose a
  clear default or ask the student which one to inspect.
- A preview starts but never becomes reachable.
- A previewable file opens successfully but does not satisfy the current
  acceptance criterion.
- A simple command includes shell metacharacters, platform shell executables,
  redirection, pipes, or command chaining.
- A terminal script attempts destructive filesystem operations, remote download
  execution, credential exposure, privilege escalation, or project-root escape.
- A terminal script produces very large output or runs too long.
- A stale approval card remains after cancellation, validation failure, app
  reload, or model/tool event ordering.
- The AI reports that preview or tests passed, but DIVE has no concrete preview
  observation, command result, or user-recorded evidence.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: DIVE MUST provide a dedicated Preview action for inspecting local
  project results.
- **FR-002**: The Preview action MUST support previewing local project HTML
  files, already-running local preview URLs, and project preview servers.
- **FR-003**: The Preview action MUST reject non-local URLs, unsupported URL
  schemes, and files outside the selected project.
- **FR-004**: The Preview action MUST reject non-previewable files instead of
  opening them through a terminal or shell workaround.
- **FR-005**: Opening or attempting to open a preview MUST be recorded in the
  local research ledger with the preview kind, requested target, result, and
  error reason when applicable.
- **FR-006**: DIVE MUST continue to provide a simple Project Command action for
  one executable with explicit arguments.
- **FR-007**: The Project Command approval MUST show the executable, arguments,
  timeout, expected project effect, and why DIVE wants to run it.
- **FR-008**: The Project Command action MUST reject or reroute shell-only
  syntax rather than running it through a platform shell.
- **FR-009**: Simple command output MUST appear in the Terminal surface and be
  logged as command evidence with bounded stdout, stderr, exit status, and
  summary.
- **FR-010**: DIVE MUST make Preview, Project Command, and Terminal Script
  actions visually and textually distinct in approval or result surfaces.
- **FR-011**: If the AI requests a Project Command whose evident purpose is to
  open a local preview, DIVE MUST not run that command and MUST offer the
  Preview action when a safe preview target can be identified.
- **FR-012**: If an approval request becomes stale, DIVE MUST close the pending
  approval affordance and explicitly state that no command ran.
- **FR-013**: DIVE MUST never treat an AI statement that preview or verification
  succeeded as verification evidence.
- **FR-014**: Preview success MUST count only as an available inspection surface;
  step completion still requires user observation, automated command evidence,
  or an explicit risk/deferral decision governed by the verification specs.
- **FR-015**: DIVE SHOULD provide a distinct Terminal Script action for
  shell-style verification only when direct Project Command or Preview actions
  cannot express the user's legitimate verification need.
- **FR-016**: Terminal Script requests MUST always require explicit high-risk
  approval and MUST never reuse approval automatically.
- **FR-017**: Terminal Script approval MUST show the full script, reason,
  expected effect, timeout, output limits, and known risk factors before the
  student can allow it.
- **FR-018**: Terminal Script execution MUST remain bounded to the selected
  project and MUST block known destructive, remote-execution, credential
  exposure, privilege escalation, and project-root escape patterns.
- **FR-019**: Terminal Script output MUST be bounded, visible in the Terminal
  surface, and logged separately from simple Project Command output.
- **FR-020**: DIVE MUST keep all three actions inside the Pi supervision
  boundary; no model-visible execution path may bypass DIVE-owned validation,
  approval, logging, and export rules.
- **FR-021**: DIVE MUST expose enough action guidance that the AI can choose
  Preview for inspection, Project Command for direct checks, and Terminal Script
  only for justified shell-style verification.
- **FR-022**: DIVE MUST preserve low-friction Work Mode by avoiding high-risk
  terminal approvals for preview or simple command tasks.
- **FR-023**: DIVE MUST log blocked, rerouted, denied, approved, completed,
  failed, and stale execution requests through the local research ledger.
- **FR-024**: Exports MUST distinguish preview events, simple command evidence,
  terminal script evidence, user observations, AI self-report, and final
  approval decisions.
- **FR-025**: Logs and exports MUST avoid raw secrets, credentials, private
  environment dumps, and unnecessary raw file bodies.
- **FR-026**: The feature MUST NOT introduce quiz, flashcard, badge, standalone
  card-deck, generic worksheet, generic warning, legacy runtime fallback, static
  provocation fallback, or AI self-report-as-verification behavior.

### Key Entities *(include if feature involves data)*

- **Preview Request**: A request to inspect a local project file, local URL, or
  project preview server through DIVE's Preview surface.
- **Preview Session**: The active preview target, status, reachable URL or file
  reference, and latest connection/error state.
- **Project Command Request**: A direct executable plus explicit arguments used
  for tests, builds, or simple project checks.
- **Terminal Script Request**: A high-risk shell-style verification script with
  full script text, reason, expected effect, approval state, and bounded result.
- **Runtime Routing Decision**: DIVE's classification of a requested action as
  Preview, Project Command, Terminal Script, blocked, rerouted, or unavailable.
- **Execution Evidence**: Bounded output, status, summary, and evidence
  references produced by Preview, Project Command, or Terminal Script actions.
- **Stale Approval State**: A user-visible approval request whose backend
  execution request is no longer pending and therefore cannot be approved or
  denied.

## DIVE v2 Boundaries *(mandatory)*

### Workflow Fit

This feature supports Execute and Verify in the real DIVE workflow. It lets a
student inspect the actual result, run concrete checks, or perform bounded
terminal verification without turning preview into command execution or command
execution into an unrestricted shell. It also supports Extend when preview or
verification fails, because the failure evidence can route to request changes,
recovery, or plan adjustment.

### Evidence Expectations

Every preview, command, terminal script, block, reroute, and stale approval
state must be grounded in concrete project state: selected project, requested
target, active step, preview availability, command text, captured output,
validation result, and final user decision. DIVE must stay silent or show a
bounded unavailable state when it lacks a safe local target or cannot explain
the requested execution. AI self-report is never verification evidence.

### Non-Goals

- This feature does not loosen the simple Project Command path into a general
  shell.
- This feature does not allow arbitrary external website browsing as Preview.
- This feature does not automatically open operating-system browsers or
  terminals without an explicit DIVE action.
- This feature does not make preview availability equivalent to step approval.
- This feature does not replace the verification coach, approval evidence gate,
  recovery flow, or SupervisorAgent review-card behavior.
- This feature does not introduce quiz, flashcard, badge, standalone card-deck,
  generic worksheet, generic warning, legacy runtime fallback, static
  provocation fallback, or AI self-report-as-verification behavior.

### Research Ledger Expectations

The local ledger must record each runtime routing decision, preview request,
preview result, command approval, command output summary, terminal script
approval, blocked pattern, denial, stale approval resolution, reroute to
Preview, user observation, and final step decision. Export must allow later
analysis to distinguish what DIVE made available for inspection from what the
student actually observed and used as approval evidence.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In preview validation fixtures for static HTML, local URL, and
  project preview server cases, 100% of valid preview requests open the Preview
  surface or produce a preview-specific unavailable state without requesting a
  platform shell command.
- **SC-002**: In blocked-preview workaround fixtures, 100% of shell-based local
  HTML open attempts are not executed and result in either a Preview reroute or
  a clear "did not run" explanation.
- **SC-003**: In direct command fixtures, 100% of ordinary test/build requests
  show one executable, explicit arguments, and bounded command output after
  completion.
- **SC-004**: In stale approval fixtures covering cancellation, validation
  failure, app reload, and event ordering, the approval card closes or changes
  state within 1 second of user interaction or result receipt.
- **SC-005**: In terminal script safety fixtures, 100% of known destructive,
  remote-execution, credential-exposure, privilege-escalation, and project-root
  escape patterns are blocked before execution.
- **SC-006**: In export validation scenarios, preview events, simple command
  evidence, terminal script evidence, AI self-report, user observation, and
  final approval decision are distinguishable for every reviewed step.
- **SC-007**: In Work Mode usability checks, preview and direct command
  verification do not require Terminal Script approval in any case where a safe
  Preview or Project Command action can express the task.

## Assumptions

- The primary user is a novice reviewing or verifying a real project step.
- Preview is limited to local project artifacts and local development URLs.
- Direct Project Command remains the default path for ordinary tests and builds.
- Terminal Script is a high-risk advanced path and may be delivered after the
  Preview and Project Command routing improvements.
- Existing verification-coach and approval-evidence specs remain authoritative
  for deciding whether a step is complete.
- Existing SupervisorAgent review-card specs remain authoritative for
  review-card triggers and questions.
