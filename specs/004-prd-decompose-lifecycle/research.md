# Research: PRD-Driven Decompose & Plan Lifecycle

## Decision: Treat The PRD As A First-Class Project Artifact

**Rationale**: The spec requires "PRD before decompose" and an artifact that can
be opened and edited anytime. The current `Interview` and `Plan` rows contain
some PRD-like fields, but they do not model version history, criterion identity,
student edits, or mutation provenance explicitly enough for export analysis.

**Alternatives considered**:

- Keep only `Interview` + `Plan`: lowest implementation cost, but weak for
  versioned PRD edits and mutation reconstruction.
- Store only `.dive/prd.md`: human-readable, but harder to validate, link, and
  export deterministically.
- Add a PRD domain layer over SQLite and export `.dive/prd.*`: selected because
  it preserves local-first auditability and lets UI stay editable.

## Decision: Stable Criteria Are Objects, Not Bare Strings

**Rationale**: Existing `acceptance_criteria: string[]` cannot support stable
step links, version provenance, or reliable "which criterion changed" logs.
Criteria should be stored as objects with `criterionId`, text, status, source,
and version metadata, while legacy strings can be adapted into generated IDs.

**Alternatives considered**:

- Reuse array indexes as IDs: fragile when criteria are inserted or reordered.
- Duplicate criterion text on every step: readable but ambiguous after edits.
- Stable object IDs with migration adapter: selected for traceability.

## Decision: Step Rationale Belongs On The Step Contract

**Rationale**: FR-004 requires every step to show why it was split that way and
which PRD criteria it satisfies. This is a step-level contract, not display-only
copy. Storing rationale with criterion links lets Rust validation reject
untraceable drafts and lets exports reconstruct the decomposition.

**Alternatives considered**:

- Render rationale only in React from LLM text: not auditable.
- Store rationale only in EventLog: hard to query and update.
- Store rationale with each step plus log changes: selected.

## Decision: Dedicated Add-Step Area Reuses Existing Append Path

**Rationale**: `workspace_plan_append_step` already validates approved plans,
step count, dependencies, duplicate steps, and EventLog activity. 004 should
extend this path with PRD delta/mutation records and criterion-link support
rather than create a second mutation mechanism.

**Alternatives considered**:

- Allow chat router to append automatically: violates the dedicated-area
  requirement and hides plan changes in chat.
- Build a separate mutation service in frontend state: bypasses Rust-owned
  validation and logging.
- Extend Rust append-step IPC and add a dedicated UI surface: selected.

## Decision: Scope Expansion Detection Is Deterministic Before Review Card

**Rationale**: Specs/002 owns SupervisorAgent/card content and specs/003 owns
presentation. 004 should only decide whether a new step appears outside current
PRD scope/criteria using deterministic checks such as missing criterion links,
new scope labels, new target files outside declared scope, or explicit user
reason. The review card remains non-blocking.

**Alternatives considered**:

- Ask the LLM whether every new step expands scope: too variable and not
  DIVE-owned.
- Always show a card for every add-step: too much friction.
- Deterministic gate then specs/002 card: selected.

## Decision: Restore Model/Provider Selection By Sharing Normal Chat Controls

**Rationale**: FR-010 identifies a current gap: `ChatArea` swaps `ChatInput`
for the interview panel, losing `RuntimeModelSelector`. The reworked interview
must expose the same selection affordance as normal chat so the first planning
conversation does not trap the user on an implicit model.

**Alternatives considered**:

- Ignore because the surface will be rewritten soon: leaves a known spec gap.
- Add a separate selector with different state: duplicate behavior.
- Share or lift the existing normal chat selector: selected.

## Decision: PRD Creation Is A Board With Interview Rail And Live Canvas

**Rationale**: The user should feel they are authoring a real project artifact,
not answering a hidden planning chat or filling out a long form. A board with a
short interview rail and live editable PRD canvas keeps the artifact visible,
supports direct student ownership, and makes the minimal PRD gate obvious.

**Alternatives considered**:

- Keep the current chat-swapped `SocraticInterviewPanel`: too easy for PRD data
  to feel like chat transcript rather than a versioned artifact.
- Use a full step-by-step wizard: clear but too high-friction and too close to a
  classroom worksheet.
- Use a modal editor only: compact but hides the creation context and model
  selector.
- Dedicated board with header, interview rail, live canvas, and action bar:
  selected.

## Decision: Onboarding Adds PRD As The Required Third Step

**Rationale**: The current onboarding model is project/provider/session. 004
requires PRD before decomposition, so onboarding must make PRD authoring the
bridge between provider setup and plan/session work. Otherwise novice users can
enter coding chat before the artifact that is supposed to govern decomposition
exists.

**Alternatives considered**:

- Keep onboarding unchanged and rely on a later plan gate: too late; the first
  product cue still says session/chat comes next.
- Add PRD as an optional link: weakens the v2 "spec before decompose" lesson.
- Make PRD the required current step after provider setup: selected.

## Decision: LLM Updates The Live PRD Through Validated Patches

**Rationale**: The interview should visibly help the student author the PRD on
each turn. A structured patch keeps the experience fluid while preserving DIVE's
authority over allowed fields, stable criterion IDs, merge rules, logging, and
official version creation.

**Alternatives considered**:

- Generate the full PRD only at the end: hides how student answers become
  criteria and makes the board feel passive.
- Let the LLM directly overwrite the PRD draft: too risky and weakens student
  ownership.
- Use validated `PrdPatch` proposals merged into a live draft: selected.

## Decision: Completed PRD Is Read Separately From Authoring

**Rationale**: The authoring board intentionally contains interview context,
patch state, editable fields, and validation hints. Those help while drafting
but overload the completed PRD review moment. A separate read view makes the
artifact feel finished and makes the next action, plan generation, obvious.

**Alternatives considered**:

- Keep the saved PRD inside the same authoring board: fast, but too visually
  busy and implies the PRD is still unstable.
- Use a modal summary: compact, but too transient for a canonical artifact.
- Use a dedicated concise read view with edit/create-plan actions: selected.
