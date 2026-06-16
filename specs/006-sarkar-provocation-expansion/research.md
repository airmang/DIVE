# Research: Sarkar Provocation Expansion

## Decision: Reuse and generalize `provocation_agent_evaluate`

**Decision**: Extend the existing Tauri command and supervisor validation path
for `plan_drafted`, `diff_ready`, and `retry_loop` rather than creating a second
review-card API.

**Rationale**: The current command already owns Pi runtime invocation,
zero-tool supervisor prompts, validation, dedup, EventLog writes, no-card/drop
responses, and UI response mapping. Reusing it keeps all review cards under one
auditable boundary.

**Alternatives considered**:

- New Tauri command per event: rejected because it duplicates runtime and
  validation logic.
- Frontend-only cards: rejected because shipped static/rule fallback is
  explicitly prohibited.
- Chat-message supervisor feedback: rejected because cards must appear near
  artifacts.

## Decision: Use deterministic event assessments before supervisor judgment

**Decision**: Add typed deterministic assessment objects for plan draft, diff
ready, and retry loop events. These assessments carry reason codes and evidence
refs and are checked before Pi is called.

**Rationale**: Sarkar-style questions should be sparse. DIVE, not the LLM, must
decide whether there is enough project evidence to ask for a review. This
matches the existing scope-expansion pattern while expanding it beyond add-step.

**Alternatives considered**:

- Let SupervisorAgent decide all eligibility from raw UI state: rejected
  because it would make event triggering non-deterministic and noisy.
- Backend refetch of all project state: rejected for the first slice because the
  UI surfaces already hold the relevant bounded artifacts and the existing
  scope-expansion path successfully passes bounded evidence through the command.

## Decision: Keep UI rendering in current artifact surfaces

**Decision**: Render through `ProvocationCardHost` in the plan approval screen
and step detail slide-in, with terminal placement only when step/session context
is available.

**Rationale**: The host already supports one primary card, evidence, actions,
dismiss, mark-irrelevant, and exposure/response logging. The existing surfaces
are where the student makes the relevant decision.

**Alternatives considered**:

- A new global review-card rail: rejected because it separates questions from
  the artifact.
- Re-enable `generateProvocationCards` in `TerminalTab`: rejected because it is
  the quarantined static rule path.

## Decision: Preserve one EventLog event type for supervisor evaluations

**Decision**: Continue using `provocation.supervisor_evaluated` for expanded
events and distinguish them by the payload `event` field.

**Rationale**: Export and sanitization already understand supervisor evaluation
payloads, including shown, none, dropped, evidence refs, decision summary, and
card/user-response correlation.

**Alternatives considered**:

- New EventLog event type for each expanded event: rejected because it fragments
  export analysis without adding useful semantics.
- Logging only shown cards: rejected because silent/drop outcomes are required
  for research reconstruction.

## Decision: Initial retry-loop evidence is step-scoped

**Decision**: Track retry-loop eligibility by active step and normalized failure
fingerprint in the deterministic supervisor gate. Use verification failure
evidence where available, and terminal failure summaries only when they can be
tied to the same active step/session.

**Rationale**: Terminal lines alone do not always identify the project step.
Retry-loop cards should be rare and grounded, so the first implementation should
prefer step-scoped evidence over a global terminal heuristic.

**Alternatives considered**:

- Global terminal repeated-error card: rejected because it can fire outside the
  relevant artifact and lacks step context.
- Frontend-only terminal repeated-error card: rejected because it would revive
  the quarantined rule-card path.

## Decision: Expand backend action allowlists to match existing UI actions

**Decision**: Add backend `SupervisorActionId` support for already-defined UI
actions that are needed by expanded cards: `add_verification_step`,
`ask_ai_for_rationale`, `revert_unrelated_changes`, `create_repro_steps`, and
`rollback_last_change`. Avoid making `retry_with_ai` the primary retry-loop
action.

**Rationale**: The frontend action resolver and logging already understand
these actions, but the current Rust supervisor allowlist is narrower. Extending
the Rust enum keeps the LLM boundary typed without inventing unnecessary new
action concepts.

**Alternatives considered**:

- Reuse only `open_diff`, `run_tests`, and `dismiss_review`: rejected because
  plan-draft and retry-loop cards need revision/recovery-oriented actions.
- Add new action kinds such as `inspect_last_change`: deferred until a visible
  UI route exists.
