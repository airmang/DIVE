# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]

**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS CLARIFICATION]

**Primary Dependencies**: [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION]

**Storage**: [if applicable, e.g., PostgreSQL, CoreData, files or N/A]

**Testing**: [e.g., pytest, XCTest, cargo test or NEEDS CLARIFICATION]

**Target Platform**: [e.g., Linux server, iOS 15+, WASM or NEEDS CLARIFICATION]

**Project Type**: [e.g., library/cli/web-service/mobile-app/compiler/desktop-app or NEEDS CLARIFICATION]

**Performance Goals**: [domain-specific, e.g., 1000 req/s, 10k lines/sec, 60 fps or NEEDS CLARIFICATION]

**Constraints**: [domain-specific, e.g., <200ms p95, <100MB memory, offline-capable or NEEDS CLARIFICATION]

**Scale/Scope**: [domain-specific, e.g., 10k users, 1M LOC, 50 screens or NEEDS CLARIFICATION]

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The plan MUST answer each DIVE v2 gate:

- **Real workflow**: Explain how the feature stays inside Decompose,
  Instruct, Execute, Verify, or Extend for a real project.
- **Evidence**: Identify the concrete project state used by any warning,
  review card, approval prompt, supervisor output, or verification decision.
- **Pi-only runtime**: Confirm the feature does not introduce legacy runtime
  fallback, provider fallback routing, Node-side execution, Pi built-ins, Pi
  resource discovery, or shell fallback.
- **Local ledger**: Define EventLog/export records for every supervision,
  approval, verification, or supervisor-agent behavior changed by this feature.
- **Low-friction supervision**: State why any added friction is warranted by
  high-risk, ambiguous, or unverified project state.
- **Typed/testable seams**: Name the typed contracts and deterministic tests
  that cover lifecycle triggers, evidence collection, parsing, drop rules,
  deduplication, cooldown, runtime boundaries, and export behavior.

If any gate does not apply, state why. Any violation MUST be listed in
Complexity Tracking with a simpler compliant alternative.

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
# DIVE desktop application
dive/
├── src/                       # React + TypeScript UI
│   ├── components/
│   ├── lib/
│   └── ...
├── src-tauri/                 # Rust supervision boundary + Tauri commands
│   ├── src/
│   └── tests/
└── pi-sidecar/                # Pi runtime sidecar, bundled for classroom builds

# Spec-driven v2 artifacts
specs/[###-feature]/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
└── tasks.md
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
