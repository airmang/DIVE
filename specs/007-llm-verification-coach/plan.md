# Implementation Plan: LLM Verification Coach

**Branch**: `codex/007-llm-verification-coach` | **Date**: 2026-06-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/007-llm-verification-coach/spec.md`

## Summary

Add an adaptive verification coach to step review. The coach uses bounded
project evidence to tell a novice how to verify the current step, while the
existing approval gate remains evidence-aware: AI guidance is not verification,
and normal approval requires an automated pass or criterion-linked user
observation. The implementation should reuse the Pi sidecar/provider runtime,
EventLog/export path, `approval_provenance`, and the existing step-review
surface, while keeping Sarkar review-card expansion separate.

## Technical Context

**Language/Version**: Rust 1.80 / edition 2021; TypeScript 5.8; React 19.1;
Vite 7; Tauri 2.

**Primary Dependencies**: Existing `serde`/`serde_json`, `rusqlite`, Tauri IPC,
Pi sidecar supervisor turn runner, React Testing Library, Vitest, and current
provider/runtime abstractions. No new runtime dependency is planned.

**Storage**: Existing SQLite `EventLog`, `Card.approval_provenance`, and
`StepSessionMapping.verification_evidence` are the primary persistence paths.
No new table is planned for MVP unless implementation proves replay requires
one.

**Testing**: Targeted Rust unit tests for coach prompt/validation/log payloads
and export summaries; targeted Vitest suites for step-review guidance,
observation evidence, DecisionGate policy, and approval provenance; existing
`pnpm typecheck`, `pnpm test:unit`, and relevant `cargo test`.

**Target Platform**: DIVE desktop app for local/classroom use with bundled Pi
sidecar and local-first project state.

**Project Type**: Desktop application with Rust/Tauri backend, React frontend,
and bundled Node-based Pi sidecar.

**Performance Goals**: Coach guidance should appear or fail to an unavailable
state within ordinary review latency. Timeout must not block request changes,
risk acceptance, recovery, or existing approval paths.

**Constraints**: No legacy runtime fallback; no static provocation fallback; no
AI self-report as verification; no standalone lesson/quiz/card deck. Coach
guidance must be validated before display and must remain visually distinct from
SupervisorAgent review cards.

**Scale/Scope**: One active step review at a time in the current product shell.
The feature handles GUI, CLI, file-output, library, and no-test steps, but does
not implement broad plan mutation or new Sarkar review-card events.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Real workflow**: Pass. The feature stays inside Verify/Extend for real
  project steps. It helps the student inspect actual changed work and decide
  approve/request-changes/risk/defer.
- **Evidence**: Pass. Guidance is grounded in PRD criteria, plan step metadata,
  changed files, available commands/previews/tests, verify logs, and prior
  observations. AI guidance itself is explicitly non-evidence.
- **Pi-only runtime**: Pass. The coach uses existing Pi/provider capability
  paths and does not add legacy/provider/shell fallback behavior.
- **Local ledger**: Pass. Guidance generation, validation/drop result, student
  observation, criterion confirmation, approval outcome, risk reason, and
  deferral reason are logged/exportable.
- **Low-friction supervision**: Pass. The added surface reduces ambiguity in an
  already-unverified state and does not require long reflection. Work Mode stays
  concise.
- **Typed/testable seams**: Pass. The plan defines typed contracts for coaching
  request/response, validation, observation evidence, approval provenance, and
  export records with deterministic tests.

No constitution violations are required.

## Phase 0 Research Summary

Research decisions are recorded in [research.md](./research.md). The selected
approach is:

- Treat verification coaching as guidance, not a review card and not evidence.
- Reuse the existing Pi sidecar zero-tool turn path for generated guidance.
- Validate coach output against supplied evidence before display.
- Store durable research data in EventLog plus existing approval provenance and
  step mapping evidence rather than adding a new table for MVP.
- Add criterion-linked user observation as a first-class concrete evidence path.
- Keep 006 Sarkar review-card expansion independent by using separate event
  names, UI components, and payload contracts.

## Phase 1 Design Summary

Design artifacts generated for this plan:

- [data-model.md](./data-model.md): verification coaching event, guide,
  observation evidence, validation result, and evidence-backed decision.
- [contracts/verification-coach.md](./contracts/verification-coach.md):
  review-time guidance request/response and validation contract.
- [contracts/step-observation-evidence.md](./contracts/step-observation-evidence.md):
  criterion-linked observation and approval provenance contract.
- [contracts/event-log-export.md](./contracts/event-log-export.md): required
  ledger/export events and redaction expectations.
- [quickstart.md](./quickstart.md): validation scenarios and commands.

## Project Structure

### Documentation (this feature)

```text
specs/007-llm-verification-coach/
|-- spec.md
|-- plan.md
|-- research.md
|-- data-model.md
|-- quickstart.md
|-- contracts/
|   |-- verification-coach.md
|   |-- step-observation-evidence.md
|   `-- event-log-export.md
`-- tasks.md
```

### Source Code (repository root)

```text
dive/
|-- src/
|   |-- components/product/
|   |   |-- StepDetailSlideIn.tsx
|   |   |-- DecisionGate.tsx
|   |   |-- decisionGatePolicy.ts
|   |   |-- VerificationCoachPanel.tsx
|   |   `-- useProductShellController.ts
|   |-- features/provocation/
|   |   |-- verificationGrade.ts
|   |   |-- verificationStatus.ts
|   |   `-- types.ts
|   |-- features/verification-coach/
|   |   |-- api.ts
|   |   |-- types.ts
|   |   `-- validation.ts
|   `-- i18n/
|       |-- en.json
|       `-- ko.json
`-- src-tauri/
    |-- src/
    |   |-- dive/
    |   |   `-- verification_coach.rs
    |   |-- ipc/
    |   |   `-- verification_coach.rs
    |   |-- export/mod.rs
    |   `-- lib.rs
    `-- tests/
```

**Structure Decision**: Add narrow verification-coach modules rather than
folding guidance into review-card/provocation modules. The existing step review
panel hosts the new component, while backend generation and validation stay
behind a dedicated Tauri IPC boundary.

## Complexity Tracking

No constitution violations or extra architecture complexity are required.
