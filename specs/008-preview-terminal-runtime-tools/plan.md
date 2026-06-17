# Implementation Plan: Preview And Terminal Runtime Tools

**Branch**: `codex/008-preview-terminal-runtime-tools` | **Date**: 2026-06-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/008-preview-terminal-runtime-tools/spec.md`

## Summary

Separate DIVE runtime actions by user intent and risk. Preview inspection
becomes a first-class action for local HTML, local URLs, and project preview
servers. Ordinary verification keeps using the existing direct Project Command
path: one executable plus explicit arguments. Shell-style verification becomes
a separate high-risk Terminal Script path with stricter approval, blocking,
logging, and export semantics. The implementation must prevent preview work
from being routed through platform shell commands and must close stale approval
cards visibly.

## Technical Context

**Language/Version**: Rust 1.80 / edition 2021; TypeScript 5.8; React 19.1;
Vite 7; Tauri 2.

**Primary Dependencies**: Existing Tauri IPC, Rust tool registry and permission
hooks, Pi sidecar custom tool definitions, React slide-in Preview/Terminal
surfaces, EventLog/export path, Vitest, React Testing Library, and cargo test.
No new external runtime dependency is planned for Preview or Project Command.

**Storage**: Existing in-memory preview process state, SQLite EventLog, message
history, approval/event records, and export summaries. MVP should avoid a new
table unless Terminal Script history later requires first-class replay.

**Testing**: Targeted Rust unit tests for preview target validation, runtime
routing, project-command validation, terminal-script blocking, EventLog/export
payloads, and stale approval handling; targeted Vitest suites for Preview tab,
ToolActivity/PermissionCard reroute affordances, Terminal tab output, and chat
session reducer behavior; existing `pnpm typecheck`, `pnpm test:unit`, and
relevant `cargo test`.

**Target Platform**: DIVE desktop app for local/classroom use with bundled Pi
sidecar, local project root, and local-first research ledger.

**Project Type**: Desktop application with Rust/Tauri backend, React frontend,
and bundled Node-based Pi sidecar.

**Performance Goals**: Preview action feedback should appear within 1 second
for static files and already-running local URLs. Preview-server startup should
reuse existing timeout behavior. Stale approval state should close or update
within 1 second of user interaction or result receipt. Terminal output must be
bounded so the UI remains responsive.

**Constraints**: Pi-only runtime boundary; no legacy runtime fallback; no
model-visible tool may bypass DIVE validation, approval, logging, and export.
Project Command remains no-shell direct argv. Preview is local-only. Terminal
Script is always high-risk and must not become the default verification path.
AI self-report remains non-evidence.

**Scale/Scope**: One active project root and one primary preview surface at a
time in the current product shell. MVP covers static HTML preview, local URL
preview, project preview server reuse/start, direct test/build commands, stale
approval cleanup, and deterministic reroute of obvious preview-open command
attempts. Terminal Script may be planned as a later vertical slice after Preview
and Project Command routing are stable.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Real workflow**: Pass. The feature stays inside Execute and Verify for real
  project work. It helps students inspect actual project output, run concrete
  checks, and route failures to request changes, recovery, or plan adjustment.
- **Evidence**: Pass. Preview, command, terminal script, blocked, rerouted, and
  stale states are grounded in project root, requested target, active step,
  preview availability, command/script text, validation result, captured output,
  and user decision. AI self-report is explicitly non-evidence.
- **Pi-only runtime**: Pass. The plan keeps all model-visible actions as
  DIVE-owned custom tools behind Rust validation/permission/logging and does not
  introduce Pi built-ins, resource discovery, Node-side execution, legacy
  runtime fallback, or shell fallback for Project Command.
- **Local ledger**: Pass. Runtime routing, preview requests/results, command
  approvals/results, terminal script approvals/results, blocked patterns,
  reroutes, stale approvals, user observations, and final decisions are
  logged/exportable with redaction.
- **Low-friction supervision**: Pass. Preview and direct commands avoid
  unnecessary high-risk approvals. Added friction is reserved for shell-style
  Terminal Script and blocked/rerouted states with concrete evidence.
- **Typed/testable seams**: Pass. The plan defines typed contracts for preview
  targets, runtime routing decisions, project command requests, terminal script
  requests, execution evidence, stale approval state, EventLog/export records,
  and deterministic tests.

No constitution violations are required.

## Phase 0 Research Summary

Research decisions are recorded in [research.md](./research.md). The selected
approach is:

- Add a dedicated Preview action instead of allowing preview through
  shell-based project commands.
- Keep Project Command as the existing direct executable plus explicit args
  path.
- Treat shell-style Terminal Script as a separate, high-risk, later vertical
  slice with a different approval contract.
- Detect common preview-open command attempts and reroute them deterministically
  to Preview when a safe local target is available.
- Make stale approvals a first-class UI state so user interaction never becomes
  a silent no-op.
- Reuse EventLog/export with bounded summaries and redaction rather than adding
  durable runtime tables for MVP.

## Phase 1 Design Summary

Design artifacts generated for this plan:

- [data-model.md](./data-model.md): PreviewRequest, PreviewSession,
  ProjectCommandRequest, TerminalScriptRequest, RuntimeRoutingDecision,
  ExecutionEvidence, and StaleApprovalState.
- [contracts/preview-runtime.md](./contracts/preview-runtime.md): Preview
  request, response, validation, and UI behavior contract.
- [contracts/project-command-routing.md](./contracts/project-command-routing.md):
  direct command and preview-reroute contract.
- [contracts/terminal-script.md](./contracts/terminal-script.md): high-risk
  terminal script request, approval, blocking, and result contract.
- [contracts/event-log-export.md](./contracts/event-log-export.md): local
  ledger and export records.
- [quickstart.md](./quickstart.md): validation scenarios and commands.

## Project Structure

### Documentation (this feature)

```text
specs/008-preview-terminal-runtime-tools/
|-- spec.md
|-- plan.md
|-- research.md
|-- data-model.md
|-- quickstart.md
|-- contracts/
|   |-- preview-runtime.md
|   |-- project-command-routing.md
|   |-- terminal-script.md
|   `-- event-log-export.md
`-- tasks.md
```

### Source Code (repository root)

```text
dive/
|-- src/
|   |-- components/chat/
|   |   `-- ToolActivity.tsx
|   |-- components/permission-card/
|   |   |-- DangerCard.tsx
|   |   |-- PermissionCard.tsx
|   |   `-- types.ts
|   |-- components/slide-in/
|   |   |-- PreviewTab.tsx
|   |   |-- TerminalTab.tsx
|   |   `-- types.ts
|   |-- components/product/
|   |   |-- StepDetailSlideIn.tsx
|   |   `-- useProductShellController.ts
|   |-- hooks/
|   |   `-- useChatSession.ts
|   |-- stores/
|   |   `-- slideIn.ts
|   `-- i18n/
|       |-- en.json
|       `-- ko.json
|-- src-tauri/
|   |-- src/
|   |   |-- agent/
|   |   |-- dive/
|   |   |   `-- event_log.rs
|   |   |-- export/
|   |   |-- ipc/
|   |   |   |-- preview.rs
|   |   |   `-- chat.rs
|   |   |-- pi_sidecar.rs
|   |   |-- tools/
|   |   |   |-- registry.rs
|   |   |   |-- run_process.rs
|   |   |   `-- terminal_script.rs
|   |   `-- lib.rs
|   `-- tests/
`-- pi-sidecar/
    `-- src/
```

**Structure Decision**: Extend the existing Preview and Terminal surfaces and
Rust supervision boundary instead of adding a separate runtime subsystem.
Preview routing should live near existing preview IPC and slide-in UI. Project
Command remains the existing `run_process` tool. Terminal Script, if
implemented, should be a distinct tool and contract rather than a mode flag on
Project Command.

## Complexity Tracking

No constitution violations or extra architecture complexity are required.
