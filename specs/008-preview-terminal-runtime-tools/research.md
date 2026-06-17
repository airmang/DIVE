# Research: Preview And Terminal Runtime Tools

## Decision: Preview Is A First-Class Runtime Action

**Decision**: Add a dedicated Preview action for static project HTML files,
local URLs, and project preview servers. Do not route preview through Project
Command or a platform shell.

**Rationale**: Previewing output is a verification/inspection action, not a
general process action. A dedicated action can enforce local-only targets,
surface preview-specific errors, open the Preview panel, and log preview
attempts without asking the student to approve opaque shell commands.

**Alternatives considered**:

- Allow `run_process` to open files through the operating system. Rejected
  because the approval card cannot truthfully describe what external opener or
  shell code may do.
- Tell the AI to stop using shell commands for preview without adding a tool.
  Rejected because model guidance alone is not a reliable product contract.

## Decision: Preview Targets Are Local And Bounded

**Decision**: Preview may target project-relative `.html`/`.htm` files, local
loopback URLs, or a project preview server started through the existing preview
flow. External URLs and non-previewable files are rejected.

**Rationale**: The Preview surface exists to inspect the student's local
project. External browsing expands scope, privacy risk, and classroom variance.
Restricting targets makes validation deterministic and keeps EventLog/export
safe.

**Alternatives considered**:

- Allow arbitrary URLs in Preview. Rejected because this turns DIVE into a
  browser and weakens the evidence boundary.
- Allow any project file. Rejected because previewing source files or binary
  assets is a different inspection workflow.

## Decision: Project Command Remains Direct Argv

**Decision**: Keep Project Command as one executable plus explicit arguments,
with no shell expansion, shell executable wrapper, command chaining, pipes, or
redirection.

**Rationale**: Direct argv commands are easy to explain and supervise. They
cover ordinary tests, builds, and simple project checks while preserving the
existing safety envelope.

**Alternatives considered**:

- Add shell support to Project Command. Rejected because it changes the meaning
  of every existing command approval and encourages risky workarounds for
  preview and multi-step scripts.
- Remove Project Command and force all verification through Terminal Script.
  Rejected because it adds high-risk friction to normal low-risk checks.

## Decision: Terminal Script Is A Separate High-Risk Slice

**Decision**: If shell-style verification is needed, introduce a distinct
Terminal Script action with its own high-risk approval, full-script display,
blocking, timeout, output bounds, and EventLog/export semantics.

**Rationale**: Some legitimate verification is easier as a short script, but it
has materially different risk than a direct command. A separate action prevents
shell semantics from leaking into simple commands.

**Alternatives considered**:

- Implement Terminal Script first. Rejected because the immediate failure is
  preview routing, and shell execution is a larger risk surface.
- Never support shell-style scripts. Rejected as too restrictive for advanced
  instructor workflows and multi-command diagnostics, but acceptable as a
  staged MVP if Preview and Project Command cover the common cases.

## Decision: Preview-Open Command Attempts Are Rerouted Deterministically

**Decision**: Detect common command requests whose evident purpose is opening a
local HTML preview and block/reroute them to Preview when a safe target can be
identified.

**Rationale**: Users should not have to understand why a shell command was
requested. DIVE can recognize the common pattern, state that the command did
not run, and offer the correct Preview action.

**Alternatives considered**:

- Let the command simply fail and rely on chat explanation. Rejected because it
  leaves the student in a dead-end permission flow.
- Auto-run Preview without any visible explanation. Rejected because the
  reroute itself is supervision-relevant and should be logged.

## Decision: Stale Approval Is A First-Class UI State

**Decision**: If an approval request is no longer pending, DIVE must close or
downgrade the card and explain that no command ran.

**Rationale**: A button that appears clickable but does nothing erodes trust.
Stale state can occur after validation failure, cancellation, reload, or event
ordering. The UI should treat it as a resolved execution state, not an active
permission request.

**Alternatives considered**:

- Refresh pending approvals silently. Rejected because the student still needs
  to know whether anything ran.
- Keep stale cards until the next chat turn. Rejected because it preserves the
  original no-response failure.

## Decision: Reuse EventLog/Export With Bounded Payloads

**Decision**: Record runtime routing, preview, command, terminal script, block,
reroute, stale, and result events through existing local ledger/export paths
with bounded summaries and redaction.

**Rationale**: The research question depends on reconstructing what action DIVE
offered, what the student approved, and what evidence was produced. Existing
EventLog/export already carries supervision events and can be extended without
new storage for MVP.

**Alternatives considered**:

- Add durable tables for every runtime action. Deferred until replay/search
  requirements exceed EventLog summaries.
- Store only chat-visible messages. Rejected because export must separate
  evidence, AI self-report, and final decisions.
