# Provocation Supervisor Agent Decision Log

**Date**: 2026-06-14
**Status**: Active Draft
**Spec**: `specs/002-provocation-supervisor-agent/spec.md`

## DEC-001: Dedicated SupervisorAgent, Not Main Coding Agent

- **Decision**: Provocation/review card evaluation uses a dedicated Pi
  SupervisorAgent separate from the main coding agent.
- **Rationale**: The coding agent optimizes for completing work; the supervisor
  critiques evidence. Keeping them separate improves auditability and reduces
  self-justification risk.
- **Implication**: The supervisor has its own one-shot call path and no shared
  memory/session with the coding turn.

## DEC-002: SupervisorDecision Is The LLM Boundary

- **Decision**: The LLM returns `SupervisorDecision`, not final UI cards.
- **Rationale**: DIVE must retain authority over evidence validation, actions,
  card identity, placement, and logging.
- **Implication**: Card rendering is allowed only after DIVE validation passes.

## DEC-003: No Tools And No Resource Discovery

- **Decision**: SupervisorAgent gets no tools, no Pi built-ins, no resource
  discovery, no filesystem/process access, and no long-term memory.
- **Rationale**: The supervisor critiques the bounded evidence bundle; it should
  not inspect or mutate the project independently.
- **Implication**: Sidecar tests must prove the supervisor session exposes zero
  tools and ignores project/global resource discovery.

## DEC-004: P1 Triggers Are E2 And E4 Only

- **Decision**: P1 supports `ai_claimed_done` and `verify_entered` only.
- **Rationale**: These events target automation bias with clear evidence. Diff
  and retry triggers are higher volume and need tuning.
- **Implication**: `plan_drafted`, `diff_ready`, and `retry_loop` require later
  specs or amendments.

## DEC-005: Failure Means Silence Plus Log

- **Decision**: Supervisor runtime failure, unavailable model, malformed output,
  invalid evidence, or duplicate decisions do not create fallback cards.
- **Rationale**: Generic fallback cards would reintroduce ungrounded warnings.
- **Implication**: Silent/drop outcomes must be logged for research audit.

## DEC-006: Keep UI, Replace Generation Path

- **Decision**: P1 keeps the existing `ProvocationCardHost` and UI-facing
  `ProvocationCard` shape, but replaces frontend keyword generation as the
  final card-generation path.
- **Rationale**: The UI already supports contextual cards, actions, dismiss,
  mark-irrelevant, and logging. The weak point is the rule/keyword generation
  authority.
- **Implication**: `rules.ts` may remain during migration, but P1 acceptance
  requires supervisor-backed generation for `ai_claimed_done` and
  `verify_entered`.

## DEC-007: Existing Logging Is Extended, Not Replaced

- **Decision**: P1 extends existing `provocation_log_event` and export
  sanitization instead of replacing the logging path.
- **Rationale**: The current path already handles card exposure, action clicks,
  dismiss, mark-irrelevant, and export redaction.
- **Implication**: New supervisor evaluation logs must include shown, dropped,
  and error outcomes before card exposure logs occur.

## DEC-008: P1 Provoke Gate Is DIVE-Owned; LLM Generates The Question

- **Decision**: For P1, DIVE deterministically decides whether to provoke from
  local verification evidence (`aiSelfReport && !concreteEvidence`). The
  SupervisorAgent is invoked only after the gate fires and is responsible for the
  criterion-linked question and suggested actions, not for the provoke decision.
- **Rationale**: The single P1 concern (`ai_self_report_only`) is mechanically
  determinable, so an LLM provoke gate would add latency, cost, and flakiness on
  the verify critical path without improving the lesson. Sarkar-style critical
  thinking lives in the *question content* (criterion-linked verification), which
  the LLM still generates — so the provocation quality is preserved.
- **Implication**: LLM-owned provoke is reserved for future subjective concerns
  (`plan_drafted`, `diff_ready`) where deciding *whether* to provoke is itself a
  judgment. The `provoke` field stays in the schema for forward-compatibility;
  in P1 a `provoke=false` is logged as `provoke_false` and yields no card.

## DEC-009: P1 Card Renders Only At `verify_entered`, Non-Blocking

- **Decision**: In P1, `ai_claimed_done` records the assistant claim as evidence
  only; the card renders only at `verify_entered`. Evaluation is non-blocking
  with a bounded budget (default 1200 ms), and a card is valid only until the
  verification/approval action is finalized.
- **Rationale**: Removes the cross-event double-fire (same concern at both
  events), keeps the card at the verification surface (US1/FR-015), and protects
  Work Mode low-friction while still landing the card before approval in the
  common case.
- **Implication**: Dedup identity is `(artifactRef, concern, evidenceHash)` and
  does not include `event`. Late results (after finalize) are dropped as
  `timeout` and logged.

## DEC-010: Student PII Is Masked/Minimized In Logs And Export

- **Decision**: Extend secret redaction so student PII (names, emails, account
  identifiers, and similar) in goal/plan/message summaries is masked or minimized
  before logging or export.
- **Rationale**: The pilot audience includes minors; the constitution's
  local-first ledger must not become a PII leak. Research analysis needs
  structure, flags, and summaries — not raw personal data.
- **Implication**: `SupervisorContext` prohibited list, `decisionSummary`, and
  `logRationale` sanitization all include unmasked PII.

## DEC-011: Canonical Supervision Mode Is `work | guided`

- **Decision**: SupervisorAgent input, validation, card identity, EventLog
  canonical fields, and export canonical fields use only two supervision modes:
  `work` and `guided`. Existing frontend `ScaffoldMode` values are
  migration-only inputs: `guided -> guided`, `standard -> work`, and
  `expert -> work`.
- **Rationale**: The product contract has only low-friction Work Mode and more
  explanatory Guided Mode. Keeping `standard` and `expert` as canonical modes
  would preserve obsolete v1 behavior and create conflicting rules for card
  frequency, copy, and audit analysis.
- **Implication**: Implementation must add an adapter before
  `SupervisorContext` construction. Unknown mode input is an `invalid_mode`
  evaluation drop. If the original UI mode is useful for migration audit, it may
  be logged as `sourceUiMode`, but it must not affect supervisor decisions.

## DEC-012: Verification Actions Are Feasibility-Aware And Never Trap The User

- **Decision**: DIVE computes which verification methods are currently feasible
  (`runnable`, `previewable`, `hasTests`, `diffAvailable`) and (a) filters
  `allowedActionIds` to feasible actions, (b) passes feasibility flags in
  `SupervisorContext`, and (c) requires the criterion-linked question to adapt to
  feasible verification. A card never blocks progress when verification is not yet
  feasible.
- **Rationale**: Field testing showed the card suggesting `open_preview` for an
  implementation too early to preview/run — confusing and, worse, unpassable.
  Verification guidance must match reality, and "AI says done but it is not even
  runnable" is itself a strong automation-bias signal worth a feasible
  provocation (for example "read the diff" instead of "open preview").
- **Implication**: DIVE must add feasibility computation; today
  `app_launched`/`preview_checked` are observations, not capabilities. The
  question/action adapt (for example to `open_diff`) when not runnable, and the
  approval gate stays passable (constitution V; FR-021/FR-025/FR-030/FR-031/FR-032).
