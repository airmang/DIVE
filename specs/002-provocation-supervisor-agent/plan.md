# Implementation Plan: Provocation Supervisor Agent

**Branch**: `main` | **Date**: 2026-06-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-provocation-supervisor-agent/spec.md`

## Summary

Build the P1 provocation/review-card path around a dedicated Pi
`SupervisorAgent` while keeping DIVE, not the LLM, authoritative for event
triggers, evidence, validation, action allowlists, card identity, placement,
logging, and export. The first implementation slice evaluates only
`verify_entered`: Rust constructs a canonical `SupervisorContext`, applies the
deterministic `aiSelfReport && !concreteEvidence` gate, invokes a zero-tool
one-shot Pi supervisor only after the gate fires, validates the returned
`SupervisorDecision`, maps valid output into the existing `ProvocationCard`
UI, and logs shown/none/dropped/error outcomes through the local
EventLog/export path.

## Technical Context

**Language/Version**: Rust 1.80 / edition 2021; TypeScript 5.8; React 19.1;
Node ESM for the Pi sidecar.

**Primary Dependencies**: Tauri 2; Vite 7; Vitest 3; React Testing Library;
`rusqlite`; `serde`/`serde_json`; `sha2`; `tokio`; `@earendil-works/pi-ai`
0.79.3; `@earendil-works/pi-coding-agent` 0.79.3.

**Storage**: Existing local SQLite database and EventLog table; no schema
migration is required for P1 unless implementation chooses to persist dedup
state beyond the in-memory session scope.

**Testing**: `cargo test` under `dive/src-tauri`; `pnpm typecheck`; `pnpm
test:unit`; targeted Vitest suites for provocation, decision gate, and
step-detail verification surfaces; sidecar boundary tests for zero enabled
tools.

**Target Platform**: DIVE desktop app built with Tauri, with bundled Pi sidecar
for classroom/local-first use.

**Project Type**: Desktop application with Rust/Tauri backend, React frontend,
and bundled Node-based Pi sidecar.

**Performance Goals**: `verify_entered` supervisor evaluation is non-blocking
and waits at most 8000 ms by default before allowing verification/final approval to
continue. Late results are dropped and logged as `timeout`.

**Constraints**: Pi-only runtime; no static fallback cards; no frontend
keyword-generated card creation in the final P1 path; no SupervisorAgent tools,
resource discovery, filesystem/process access, or shared main-agent session;
EventLog/export data must be sanitized and distinguish AI self-report from
concrete verification evidence.

**Scale/Scope**: P1 only covers `ai_claimed_done` evidence recording and
`verify_entered` card rendering for the single `ai_self_report_only` concern.
Future `plan_drafted`, `diff_ready`, and `retry_loop` events remain out of
scope.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Real workflow**: Pass. The feature runs at the Verify/final approval point
  of the existing Decompose -> Instruct -> Execute -> Verify -> Extend flow. It
  does not introduce a lesson, quiz, standalone card deck, or generic warning
  stream.
- **Evidence**: Pass. Cards can reference only DIVE-assigned `EvidenceRef`
  values from project state: assistant completion claim, verification log, diff
  review, preview/app observation, test result, manual check, terminal error, or
  plan/goal context. AI self-report is evidence, but never verification
  evidence.
- **Pi-only runtime**: Pass. The only model call is a Pi sidecar one-shot
  supervisor turn with explicit `tools: []`, disabled built-ins, no resource
  discovery, no filesystem/process access, and no legacy/static fallback.
- **Local ledger**: Pass. Every evaluation writes a local
  `SupervisorEvaluationLog` through EventLog/export, including `shown`,
  `none`, `dropped`, and `error` outcomes. Existing card exposure/action logs
  are extended rather than replaced.
- **Low-friction supervision**: Pass. Work Mode remains non-blocking. A card is
  created only for concrete unverified state (`aiSelfReport &&
  !concreteEvidence`), deduped by artifact/concern/evidence hash, capped to one
  focal question, and never traps the approval flow when verification is not
  feasible.
- **Typed/testable seams**: Pass. The implementation introduces typed Rust
  domain models for `SupervisorContext`, `EvidenceRef`, `SupervisorDecision`,
  validation/drop results, evaluation logs, canonical mode mapping, feasibility
  flags, hash/dedup keys, and IPC contracts. Deterministic tests cover parsing,
  validation, mode normalization, evidence collection, action filtering,
  deduplication, runtime boundaries, and export sanitization.

No constitution violations are required.

## Phase 0 Research Summary

Research decisions are recorded in [research.md](./research.md). The selected
approach is:

- Keep the existing card host/rendering surface, but replace frontend rule
  generation as the P1 final path.
- Add Rust-owned supervisor domain types and validation before any UI mapping.
- Normalize existing `guided | standard | expert` UI mode inputs into canonical
  `guided | work` before SupervisorAgent input, validation, logging, or export.
- Reuse the Pi sidecar protocol but add a supervisor turn path that sends
  explicit `tools: []` and asserts zero enabled tools.
- Keep review-card actions evidence-seeking; `continue_with_risk` and
  `verification_deferred` are DecisionGate-owned proceed outcomes, not
  SupervisorAgent-suggested actions.

## Phase 1 Design Summary

Design artifacts generated for this plan:

- [data-model.md](./data-model.md): supervisor context, evidence, feasibility,
  decision, validation, card mapping, log, and dedup entities.
- [contracts/supervisor-agent.md](./contracts/supervisor-agent.md): bounded
  SupervisorAgent input/output and validation contract.
- [contracts/tauri-command.md](./contracts/tauri-command.md): proposed Tauri
  IPC command and frontend response contract.
- [contracts/event-log-export.md](./contracts/event-log-export.md): EventLog
  and export event fields.
- [quickstart.md](./quickstart.md): validation scenarios and commands for the
  implementation phase.

## Project Structure

### Documentation (this feature)

```text
specs/002-provocation-supervisor-agent/
├── spec.md
├── decisions.md
├── implementation-gap.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── supervisor-agent.md
│   ├── tauri-command.md
│   └── event-log-export.md
└── tasks.md              # Created by /speckit-tasks, not this phase
```

### Source Code (repository root)

```text
dive/
├── src/
│   ├── components/product/
│   │   ├── StepDetailSlideIn.tsx
│   │   ├── DecisionGate.tsx
│   │   └── decisionGatePolicy.ts
│   └── features/provocation/
│       ├── ProvocationCard.tsx
│       ├── ProvocationCardHost.tsx
│       ├── useProvocationActionResolver.ts
│       ├── types.ts
│       ├── priority.ts
│       ├── verificationGrade.ts
│       ├── verificationStatus.ts
│       └── logging.ts
├── src-tauri/
│   └── src/
│       ├── dive/
│       │   ├── supervisor.rs          # New Rust domain/validation module
│       │   └── event_log.rs           # Extend event classification if needed
│       ├── ipc/
│       │   ├── provocation.rs         # Existing card log IPC
│       │   └── provocation_agent.rs   # New evaluate IPC command
│       ├── pi_sidecar.rs              # Add supervisor turn runner
│       ├── pi_sidecar/protocol.rs     # Reuse/extend sidecar event parsing
│       └── export/mod.rs              # Extend sanitizer/export coverage
└── pi-sidecar/
    └── src/index.mjs                  # Reuse explicit tools=[] behavior
```

**Structure Decision**: Keep the repo and UI baseline. Put deterministic
supervisor evidence, hashing, validation, and logging authority in Rust under a
small domain module plus IPC adapter. Keep React responsible for rendering,
user interaction, and feasibility observations it can actually prove. Keep the
Pi sidecar as a bounded one-shot model transport, not as a source of project
state.

## Implementation Strategy

1. **Rust domain first**: Add `SupervisorMode`, mode normalization,
   `SupervisorContext`, `EvidenceRef`, `SupervisorDecision`,
   `SupervisorValidationResult`, drop reasons, canonical serialization,
   `contextHash`, `evidenceHash`, deterministic `cardId`, and session dedup.
2. **Validation before runtime**: Unit-test validation and mapping using fixed
   supervisor output before adding the Pi call. This isolates prompt/runtime
   variability from deterministic DIVE behavior.
3. **Pi supervisor turn**: Add a sidecar runner that sends explicit `tools: []`,
   uses a short timeout budget for verify flow, captures model/usage/latency
   where available, and treats malformed/late/error output as no card plus log.
4. **EventLog/export**: Add `provocation.supervisor_evaluated` (or equivalent)
   before exposure logs, preserve `provocation_log_event`, extend sanitization,
   and ensure `sourceUiMode` is optional migration metadata while canonical
   `mode` is only `work | guided`.
5. **Verify UI integration**: Replace P1 verify/final approval card generation
   with backend evaluation, disable frontend keyword rules in shipped/classroom
   P1 path, filter infeasible actions, repair no-op evidence marking, unify the
   concrete-verification definition across gate/roadmap/provenance/export, and
   add the non-risk `verification_deferred` DecisionGate path.
6. **QA and rollback**: Keep old rule path only behind a dev/internal migration
   flag until supervisor-backed P1 passes tests. Do not ship the old path as a
   fallback.

## Risks And Mitigations

- **Runtime latency at approval**: Mitigated by an 8000 ms default bounded
  wait budget with QA/classroom tuning, late
  result drop, and non-blocking Work Mode.
- **LLM output variance**: Mitigated by strict JSON parsing, fixed P1 concern,
  fixed rendered severity, evidence/action allowlists, question/length checks,
  and no static fallback.
- **False verification evidence**: Mitigated by a single canonical
  concrete-evidence definition and feasibility-aware evidence marking; clicking
  preview/run app is not evidence unless the preview/app is actually available,
  shown, and tied to criterion confirmation.
- **Mode migration confusion**: Mitigated by the canonical mode adapter and
  optional `sourceUiMode` logging.
- **Export privacy**: Mitigated by extending existing sanitizer tests for raw
  code, transcript, terminal output, secrets, and student PII.

## Post-Design Constitution Check

- **Real workflow**: Pass. Design remains anchored to `verify_entered`.
- **Evidence**: Pass. All cards depend on DIVE-owned evidence refs and
  feasibility flags.
- **Pi-only runtime**: Pass. Supervisor path uses Pi sidecar with zero tools and
  no fallback.
- **Local ledger**: Pass. Evaluation, none/dropped/error, exposure, action,
  dismiss, and mark-irrelevant outcomes remain exportable.
- **Low-friction supervision**: Pass. The plan keeps cards sparse,
  non-blocking, deduped, and feasibility-aware.
- **Typed/testable seams**: Pass. Contracts and quickstart define deterministic
  Rust, sidecar, frontend, and export tests.

No constitution violations are introduced by the design.

## Complexity Tracking

No constitution violations or unjustified extra architecture are required.
