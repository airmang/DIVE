# Implementation Plan: Sarkar Provocation Expansion

**Branch**: `codex/sarkar-provocation-expansion` | **Date**: 2026-06-16 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/006-sarkar-provocation-expansion/spec.md`

## Summary

Add three sparse Sarkar-style review-card events to the existing
SupervisorAgent path: `plan_drafted`, `diff_ready`, and `retry_loop`. The
implementation will generalize the current `provocation_agent_evaluate` typed
contract, add deterministic event-specific evidence builders and provoke gates,
render cards near the relevant plan, diff/step-review, or failure artifact, and
preserve the existing no-static-fallback, local EventLog/export, and Pi-only
runtime constraints.

## Technical Context

**Language/Version**: TypeScript + React for the UI; Rust 2021/Tauri for the
supervision boundary and local persistence.

**Primary Dependencies**: Existing React components and Zustand stores,
`@tauri-apps/api/core` invoke boundary, Rust `serde`/`serde_json`, `rusqlite`,
Pi sidecar supervisor runtime, Vitest, and Cargo tests.

**Storage**: Existing SQLite EventLog/export path, existing session/plan/step
tables, and bounded in-memory UI state for dedup-visible cards. No new external
service storage.

**Testing**: `pnpm test:unit`/Vitest for UI adapters and component placement;
Rust unit/integration tests under `dive/src-tauri` for supervisor validation,
drop rules, EventLog, and export sanitization.

**Target Platform**: DIVE desktop app running the existing Tauri + React shell.

**Project Type**: Desktop application with Rust-owned supervision and local
research ledger.

**Performance Goals**: At most one supervisor evaluation per eligible decision
point; bounded evidence summaries; no UI blocking while supervisor evaluation
runs; reuse existing supervisor timeout handling.

**Constraints**: Pi-only runtime, no legacy/static fallback cards, no frontend
keyword/list card generation in shipped builds, concrete evidence refs required,
one card per decision point, strict action allowlists, secret-safe logs/exports.

**Scale/Scope**: Three new review events, one shared Tauri command, current card
host reuse, and focused tests around plan approval, changed-work review, and
repeated failure/recovery.

## Constitution Check

*GATE: Pass before Phase 0 research. Re-check after Phase 1 design.*

- **Real workflow**: Pass. The events stay inside Decompose/Instruct
  (`plan_drafted`), Verify (`diff_ready`), and Execute/Verify recovery
  (`retry_loop`) for real project artifacts.
- **Evidence**: Pass. Cards require bounded refs from plan draft contents,
  acceptance criteria, verification coverage, changed files, expected files,
  PRD/step scope, terminal or verification failures, retry count, and recovery
  state. No card appears without evidence refs.
- **Pi-only runtime**: Pass. The plan reuses the zero-tool Pi SupervisorAgent
  path behind `provocation_agent_evaluate`; it does not add legacy runtime,
  provider fallback, Node-side execution, Pi built-ins, resource discovery, or
  shell fallback.
- **Local ledger**: Pass. Every expanded event writes
  `provocation.supervisor_evaluated` with event type, artifact ref, evidence
  refs, validation outcome, drop reason, card id, model metadata, and response
  correlation through existing card exposure/response logs.
- **Low-friction supervision**: Pass. Events are sparse, non-blocking,
  deduplicated, and limited to ambiguous or unverified decision points.
  Ordinary low-risk approvals and expected diffs stay silent.
- **Typed/testable seams**: Pass. The implementation will add typed request
  variants, event-specific assessment contracts, Rust enum variants, evidence
  kinds, action allowlists, deterministic gate helpers, and unit tests for
  lifecycle triggers, drop rules, dedup, runtime boundaries, and export.

## Project Structure

### Documentation (this feature)

```text
specs/006-sarkar-provocation-expansion/
|-- spec.md
|-- plan.md
|-- research.md
|-- data-model.md
|-- quickstart.md
|-- contracts/
|   `-- expanded-supervisor-events.md
`-- checklists/
    `-- requirements.md
```

### Source Code (repository root)

```text
dive/
|-- src/
|   |-- components/product/
|   |   |-- PlanDraftApprovalScreen.tsx
|   |   |-- StepDetailSlideIn.tsx
|   |   `-- PlanAddStepPanel.tsx
|   |-- components/slide-in/
|   |   `-- TerminalTab.tsx
|   |-- features/provocation/
|   |   |-- adapters.ts
|   |   |-- types.ts
|   |   |-- ProvocationCardHost.tsx
|   |   `-- logging.ts
|   |-- features/roadmap/
|   `-- stores/
`-- src-tauri/
    |-- src/dive/
    |   |-- supervisor.rs
    |   `-- event_log.rs
    |-- src/ipc/
    |   `-- provocation_agent.rs
    |-- src/export/
    |   `-- mod.rs
    `-- src/workspace_plan/
        `-- artifacts.rs
```

**Structure Decision**: Keep the current repository and current card UI. Add
the expanded events by extending the existing provocation supervisor seam
rather than introducing a second card system or new runtime boundary.

## Phase 0 Research

Research is recorded in [research.md](research.md). Key decisions:

- Generalize `provocation_agent_evaluate` instead of adding a new command.
- Add event-specific deterministic assessments and evidence refs before Pi
  supervisor judgment.
- Render through `ProvocationCardHost` at existing artifact-adjacent surfaces.
- Reuse `provocation.supervisor_evaluated` and existing export sanitization.

## Phase 1 Design

Design artifacts:

- [data-model.md](data-model.md)
- [contracts/expanded-supervisor-events.md](contracts/expanded-supervisor-events.md)
- [quickstart.md](quickstart.md)

### Implementation Approach

1. **Shared contracts**
   - Extend TypeScript `SupervisorEvent` with `plan_drafted`, `diff_ready`,
     and `retry_loop`.
   - Generalize `SupervisorArtifactRef` to include plan draft and failure
     artifacts while preserving `step`, `add_step_draft`, and `plan_mutation`.
   - Add event-specific assessment contracts:
     `PlanDraftReviewAssessment`, `DiffReadyReviewAssessment`, and
     `RetryLoopReviewAssessment`.
   - Extend Rust `SupervisorEvent`, `EvidenceKind`, `ProvocationCardType`,
     stage mapping, expected concern mapping, prompt action instructions, and
     action allowlists. Prefer existing frontend action kinds
     (`add_verification_step`, `ask_ai_for_rationale`,
     `revert_unrelated_changes`, `create_repro_steps`,
     `rollback_last_change`) before introducing any new action kind.

2. **Deterministic evidence and gates**
   - `plan_drafted`: eligible only before plan approval when deterministic
     assessment finds weak verification coverage, missing criterion linkage, or
     overly broad steps with evidence refs.
   - `diff_ready`: eligible only when changed-work evidence exists and
     deterministic comparison finds unexpected/out-of-scope/high-risk changed
     files. File changes alone are not enough.
   - `retry_loop`: eligible only after the same normalized failure fingerprint
     recurs at least twice for the same active step without success, recovery,
     rollback, or materially different failure evidence.

3. **Frontend placement**
   - `PlanDraftApprovalScreen.tsx`: replace shipped no-op rule-card generation
     with a `plan_drafted` SupervisorAgent request and render through the
     existing host beside the plan approval artifact.
   - `StepDetailSlideIn.tsx`: add `diff_ready` evaluation near the changed-work
     or step-review area using changed files, expected files, PRD/step scope,
     and diff-view state.
   - `StepDetailSlideIn.tsx`: add the first `retry_loop` evaluation near the
     verification failure/recovery artifact using step-scoped failure evidence.
     `TerminalTab.tsx` may show the same backend-backed card only if the active
     step/session context and failure fingerprint are available. Do not re-enable
     terminal rule cards or global terminal heuristics.

4. **Backend validation and mapping**
   - Build expanded `SupervisorContext` variants from bounded request data.
   - Gate expanded events before calling Pi. A false gate records no-card.
   - Validate schema version, concern, question shape, known evidence refs,
     allowed actions, duplicate/cooldown, and content caps with the existing
     validation path.
   - Map valid decisions into existing `ProvocationCard` responses with
     event-specific type/stage/title/message and no approve/proceed action.
   - Extend EventLog agency enrichment so `plan_drafted` maps to plan review,
     `diff_ready` maps to diff review, and `retry_loop` maps to verification
     failure/recovery rather than falling through to the generic verify state.

5. **Ledger and export**
   - Keep `provocation.supervisor_evaluated` as the canonical evaluation event.
   - Ensure `event`, `artifactRef`, `evidenceRefs`, `validationOutcome`,
     `dropReason`, `decisionSummary`, `cardId`, and `supervisorEvaluationId`
     export for shown, none, and dropped outcomes.
   - Update export artifact contract text so 006 events are documented.

## Complexity Tracking

No constitution violations are planned.

## Post-Design Constitution Check

- **Real workflow**: Pass. Each UI placement is adjacent to the real artifact
  being judged.
- **Evidence**: Pass. Each event requires typed evidence refs and an
  event-specific deterministic assessment before supervisor judgment.
- **Pi-only runtime**: Pass. Only the existing Pi SupervisorAgent turn is used.
- **Local ledger**: Pass. Existing EventLog/export semantics are extended, not
  bypassed.
- **Low-friction supervision**: Pass. Events remain non-blocking and
  deduplicated.
- **Typed/testable seams**: Pass. Contracts and tests are defined in the data
  model, contract, and quickstart artifacts.
