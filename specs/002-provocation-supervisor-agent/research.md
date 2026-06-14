# Research: Provocation Supervisor Agent

**Date**: 2026-06-14
**Spec**: [spec.md](./spec.md)

## Decision: Keep Current Repo And UI Host, Replace P1 Generation Authority

- **Decision**: Keep `ProvocationCardHost` and the UI-facing
  `ProvocationCard` rendering target, but remove frontend keyword/rule
  generation from the shipped P1 path.
- **Rationale**: The existing host already handles placement, primary card
  selection, dismiss, mark-irrelevant, action clicks, and exposure logging. The
  fragile part is generation authority: `rules.ts` and `generateProvocationCards`
  make card decisions in frontend heuristics without Rust-owned evidence
  validation.
- **Alternatives considered**:
  - Rewrite the whole card UI: rejected because the current UI can render the
    P1 target and `specs/003-supervision-card-ux` owns presentation cleanup.
  - Keep frontend rule generation as fallback: rejected because static fallback
    cards are explicitly prohibited.

## Decision: Rust Owns Supervisor Domain And Validation

- **Decision**: Add a Rust domain boundary for `SupervisorContext`,
  `EvidenceRef`, `SupervisorDecision`, validation results, drop reasons,
  canonical hashes, dedup keys, and evaluation logs.
- **Rationale**: Constitution VI requires typed/testable seams. Rust already
  owns Tauri IPC, EventLog persistence, export sanitization, Pi sidecar
  invocation, and permission/verification-adjacent backend state. Keeping the
  canonical bundle there prevents frontend text assembly from becoming the real
  spec.
- **Alternatives considered**:
  - TypeScript-only adapter: rejected because it cannot enforce EventLog/export
    and runtime boundary contracts.
  - Let SupervisorAgent return final cards: rejected because DIVE must retain
    evidence, action, placement, and logging authority.

## Decision: P1 Provoke Gate Is Deterministic And DIVE-Owned

- **Decision**: For P1, DIVE calls SupervisorAgent only after the deterministic
  gate `aiSelfReport && !concreteEvidence` fires at `verify_entered`.
  `ai_claimed_done` records evidence only and does not render a card.
- **Rationale**: The single P1 concern, `ai_self_report_only`, is mechanically
  knowable from local verification state. The LLM adds value in the
  criterion-linked question, not in deciding whether this concern exists.
- **Alternatives considered**:
  - LLM-owned provoke gate: reserved for future subjective events like
    `plan_drafted` or `diff_ready`.
  - Render at both `ai_claimed_done` and `verify_entered`: rejected because it
    creates duplicate interruptions for the same artifact/evidence state.

## Decision: Canonical Mode Is `work | guided`

- **Decision**: Normalize existing `ScaffoldMode` values before supervisor
  evaluation: `guided -> guided`, `standard -> work`, and `expert -> work`.
  Unknown mode drops/logs `invalid_mode`.
- **Rationale**: The v2 product contract has Work Mode and Guided Mode only.
  Keeping `standard` or `expert` as canonical modes would preserve obsolete v1
  behavior and make audit analysis ambiguous.
- **Alternatives considered**:
  - Preserve three modes in P1: rejected because it conflicts with the v2
    Work/Guided contract.
  - Remove all frontend mode values before implementation: rejected as a larger
    UI migration than this P1 supervisor slice requires.

## Decision: Add A Zero-Tool Pi Supervisor Turn

- **Decision**: Reuse the Pi sidecar transport but add a supervisor call path
  that sends explicit `tools: []`, disables built-ins/resource discovery, and
  asserts `enabled_tools == []` from the sidecar `ready` event.
- **Rationale**: The current sidecar already supports explicit `tools: []` and
  no-discovery resource loading. P1 needs a separate one-shot evaluator without
  `dive_context` fallback, filesystem/process access, or shared main-agent
  session.
- **Alternatives considered**:
  - Reuse the main coding agent session: rejected because it creates
    self-supervision and shared-memory ambiguity.
  - Add a Node-side project inspector: rejected because SupervisorAgent can only
    critique DIVE-provided evidence and Node-side mutation/process access is
    prohibited.

## Decision: Strict Structured JSON Boundary

- **Decision**: SupervisorAgent output is parsed as a single
  `SupervisorDecision` JSON object. Malformed JSON, unsupported schema version,
  missing evidence, unknown evidence refs, non-question text, over-long focal
  questions, disallowed concerns, duplicates, and timeouts produce no card plus
  a logged drop/error.
- **Rationale**: This keeps LLM variability away from UI rendering and research
  logs. Unknown action IDs are stripped and logged because the card can still be
  valid without them.
- **Alternatives considered**:
  - Natural-language parsing: rejected as too brittle for audit.
  - Auto-truncating over-long questions: rejected because it can distort the
    criterion-linked question.

## Decision: Feasibility Filters Actions And Prevents Traps

- **Decision**: DIVE computes `runnable`, `previewable`, `hasTests`, and
  `diffAvailable` before building `SupervisorContext`; infeasible actions are
  excluded from `allowedActionIds`. When no concrete verification is feasible,
  the card remains non-blocking and the verification/approval gate provides
  `verification_deferred`, a clearly labeled non-risk proceed path outside the
  SupervisorAgent action list. `continue_with_risk` remains a separate
  risk-accepted gate outcome.
- **Rationale**: Field-confirmed defects show that offering `open_preview` or
  `run_app` before those actions are possible can fabricate evidence or trap
  the user. Review-card actions should help gather evidence; proceed/approval
  semantics belong to the DecisionGate.
- **Alternatives considered**:
  - Keep `continue_with_risk` as the only forward path: rejected because
    unverifiable early work is not necessarily risk acceptance.
  - Let SupervisorAgent decide feasibility: rejected because feasibility is
    concrete DIVE project state.

## Decision: Concrete Verification Has One Canonical Definition

- **Decision**: DecisionGate, agency/roadmap state, approval provenance,
  supervisor context, and export ledger must share the same strict definition
  of concrete verification evidence. Preview/app viewed signals are not
  concrete evidence unless the observation is actually available, shown, and
  tied to criterion confirmation.
- **Rationale**: Current code can mark preview/app evidence on click, before
  anything is actually observed. That makes the gate, roadmap state, and export
  disagree about whether the work was verified.
- **Alternatives considered**:
  - Keep separate frontend/backend definitions: rejected because it lets one
    path claim `verified_with_evidence` on weaker grounds.
  - Treat any preview/app open attempt as evidence: rejected because no-op or
    infeasible actions would fabricate verification.

## Decision: Extend Existing EventLog/Export Path

- **Decision**: Add supervisor evaluation records to the existing local
  EventLog/export pipeline and reuse/extend the provocation sanitizer.
- **Rationale**: The current path already supports card exposure/action logs and
  export redaction. P1 adds none/dropped/error evaluation outcomes before UI
  exposure logs.
- **Alternatives considered**:
  - Add a separate supervisor log store: rejected because research export must
    reconstruct workflow, evidence, card, and response in one local ledger.
  - Log only shown cards: rejected because none/dropped/error outcomes are
    essential for research audit.
