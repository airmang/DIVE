# Implementation Plan: PRD-Driven Decompose & Plan Lifecycle

**Branch**: `main` | **Date**: 2026-06-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/004-prd-decompose-lifecycle/spec.md`

## Summary

Elevate the existing Socratic planning interview into a dedicated PRD Authoring
Board, then make every decomposition step traceable to stable PRD
acceptance criteria and a short challengeable rationale. The implementation
keeps the current DIVE repository and plan UI baseline, extends the existing
workspace-plan Rust/Tauri boundary, restores model/provider selection during the
interview, adds persistent PRD version and plan-mutation records, and reuses
existing plan dashboard, approval, roadmap, and step detail surfaces for
criterion-linked decomposition and dedicated mid-flow step additions. First-run
onboarding is updated so project/provider setup leads into PRD authoring before
generic session or plan execution. Each interview turn can produce a validated
PRD patch that updates the live draft without creating an official PRD version
until the student saves. Saved PRDs open in a separate concise read view rather
than the drafting board.

## Technical Context

**Language/Version**: Rust 1.80 / edition 2021; TypeScript 5.8; React 19.1;
Vite 7; Tauri 2.

**Primary Dependencies**: `rusqlite`; `serde`/`serde_json`; Tauri IPC; React
Testing Library; Vitest; existing Pi provider runtime and planning hooks; no new
runtime dependency is required for the first slice.

**Storage**: Existing local SQLite database and `.dive/` artifact export path.
Use current `Plan`, `Step`, `Interview`, and `EventLog` tables where compatible;
add small migration-backed tables only for PRD version history and explicit
plan-mutation/objection records if JSON payloads on existing rows cannot provide
auditable reconstruction.

**Testing**: `cargo test` under `dive/src-tauri`; `pnpm typecheck`; `pnpm
test:unit`; targeted Vitest suites for `SocraticInterviewPanel`,
`PlanDraftApprovalScreen`, `PlanDashboardPanel`, `StepDetailSlideIn`, planning
decoders, and EventLog/export payloads.

**Target Platform**: DIVE desktop app for local/classroom use, with bundled Pi
sidecar and local-first SQLite state.

**Project Type**: Desktop application with Rust/Tauri backend, React frontend,
and bundled Node-based Pi sidecar.

**Performance Goals**: PRD open/edit/save and dedicated add-step flows complete
within ordinary local UI latency; decomposition rendering remains synchronous
from stored plan data; any AI-assisted PRD or re-decomposition suggestion is
non-blocking and may fail open to editable local state without creating a
fallback runtime.

**Constraints**: PRD before decomposition; no quiz/score/badge/long wizard; no
chat-only step mutation; no change to verify/approval flow logic; no
user-visible legacy runtime fallback; model/provider selection must remain
available during the interview; every PRD edit, step rationale challenge, and
plan mutation must be local-first logged/exportable with PII masking.

**Scale/Scope**: One active project PRD/plan lifecycle at a time in the current
workspace-plan model; existing execution envelope of small supervised steps is
preserved, including the current max-step and per-step validation constraints.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Real workflow**: Pass. The feature lives inside Decompose and Instruct, with
  mid-flow updates that support Execute/Verify/Extend when real verification
  reveals missing work. It turns the existing interview into the student's actual
  project PRD, not a lesson track.
- **Evidence**: Pass. Review-card involvement is limited to concrete state:
  stored PRD criteria, step criteria links, plan mutation diffs, objections, and
  scope-expansion detection. Generic warnings are out of scope, and specs/002
  remains authoritative for review-card content and feasibility.
- **Pi-only runtime**: Pass. This plan does not add legacy runtime fallback,
  provider fallback routing, Node-side filesystem/process mutation, Pi built-in
  tools, Pi resource discovery, or shell fallback. Existing provider/model
  selection is restored as a UI capability for the interview; it does not change
  the v2 runtime boundary.
- **Local ledger**: Pass. Required records are `prd_authored`, `prd_edited`,
  `prd_version_created`, `plan_generated`, `plan_step_rationale_challenged`,
  `plan_step_appended`, `plan_step_changed`, and scope-expansion supervisor
  evaluation/exposure events via specs/002. Exports must reconstruct the PRD,
  criteria links, rationales, objections, and plan mutations without raw secrets
  or student PII.
- **Low-friction supervision**: Pass. The only hard prerequisite is a minimal
  PRD before first decomposition. Objections and re-decomposition suggestions
  are non-blocking. Adding a step is one dedicated-plan-area action; criterion
  links are encouraged and AI-assisted but not forced. The PRD Authoring Board
  avoids wizard-style gating by requiring only goal plus one acceptance criterion.
- **Typed/testable seams**: Pass. The implementation introduces typed
  `ProjectSpec`, `AcceptanceCriterion`, `DecompositionRationale`,
  `PlanMutation`, `Objection`, PRD version, and IPC contracts. Deterministic
  tests cover PRD-before-decompose, stable criterion IDs, step-rationale
  validation, append-step validation, scope-expansion detection, logging, export
  redaction, and model selector preservation.

No constitution violations are required.

## Phase 0 Research Summary

Research decisions are recorded in [research.md](./research.md). The selected
approach is:

- Store the PRD as a first-class project artifact while preserving existing
  `Plan`/`Step` compatibility during migration.
- Represent acceptance criteria as stable objects (`criterionId`, text,
  source/version metadata), while allowing old string arrays to be read through
  a migration adapter.
- Attach step rationale and linked criterion IDs to each step rather than
  relying on generic text in the existing `acceptance_criteria` array.
- Keep mid-flow step addition in a dedicated plan area backed by
  `workspace_plan_append_step`; route chat may propose a draft, but chat does
  not silently mutate the plan.
- Use specs/002 review-card machinery only for scope-expansion concern after
  deterministic DIVE-owned comparison says the new step exceeds the current PRD.
- Replace the chat-swapped interview panel with a PRD Authoring Board composed
  of a compact header, interview rail, live PRD canvas, and bottom action bar.
- Update first-run onboarding from `project -> provider -> session` to
  `project -> provider -> PRD -> plan/session`.
- Add a turn-by-turn `PrdPatch` validation/merge path so the LLM can help fill
  the live PRD draft while DIVE owns merge authority and criterion IDs.
- Add a separate Final PRD Read View for saved PRDs to reduce cognitive load and
  make plan handoff clear.

## Phase 1 Design Summary

Design artifacts generated for this plan:

- [data-model.md](./data-model.md): PRD, criteria, rationale, mutation,
  objection, version, and export entities.
- [contracts/workspace-plan-ipc.md](./contracts/workspace-plan-ipc.md):
  proposed Tauri IPC commands and payload compatibility rules.
- [contracts/ui-lifecycle.md](./contracts/ui-lifecycle.md): required UI states
  for PRD authoring, criterion-linked decomposition, challenge, and add-step.
- [contracts/event-log-export.md](./contracts/event-log-export.md): EventLog
  event names, required payload fields, and export redaction expectations.
- [quickstart.md](./quickstart.md): validation scenarios and commands for the
  implementation phase.

## Project Structure

### Documentation (this feature)

```text
specs/004-prd-decompose-lifecycle/
├── spec.md
├── decisions.md
├── checklists/
│   └── requirements.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── workspace-plan-ipc.md
│   ├── ui-lifecycle.md
│   └── event-log-export.md
└── tasks.md              # Created by /speckit-tasks, not this phase
```

### Source Code (repository root)

```text
dive/
├── src/
│   ├── components/chat/
│   │   └── ChatArea.tsx                     # Preserve model/provider control
│   ├── components/product/
│   │   ├── GetStartedChecklist.tsx          # Add PRD onboarding step
│   │   ├── PrdAuthoringBoard.tsx            # New PRD board surface
│   │   ├── SocraticInterviewPanel.tsx       # Remove or keep as internal rail
│   │   ├── PlanDraftApprovalScreen.tsx      # Show PRD criteria links/rationales
│   │   ├── PlanDashboardPanel.tsx           # Dedicated add-step entry point
│   │   ├── RoadmapPanel.tsx                 # Render linked criteria/rationale
│   │   └── StepDetailSlideIn.tsx            # Challenge rationale from step detail
│   ├── features/planning/
│   │   ├── types.ts                         # ProjectSpec/criteria/mutation types
│   │   ├── usePlan.ts                       # PRD + mutation IPC hooks
│   │   └── usePlanInterviewLLM.ts           # Decode stable criteria/rationale
│   └── features/provocation/
│       └── ...                              # Reuse specs/002 scope card path only
├── src-tauri/
│   └── src/
│       ├── db/
│       │   ├── migrations.rs                # Add PRD version/mutation storage if needed
│       │   ├── models.rs
│       │   └── dao/
│       │       ├── plan.rs
│       │       ├── step.rs
│       │       └── prd.rs                   # New only if separate PRD table is chosen
│       ├── dive/
│       │   ├── plan_interview.rs            # Prompt/schema for PRD authoring
│       │   └── event_log.rs                 # Plan/PRD event enrichment + redaction
│       ├── ipc/
│       │   └── workspace_plan.rs            # PRD, rationale, mutation IPC
│       └── workspace_plan/
│           └── artifacts.rs                 # Export PRD + criterion-linked plan
└── pi-sidecar/
    └── src/index.mjs                        # No new tool/runtime authority
```

**Structure Decision**: Keep DIVE's current Tauri/React workspace-plan boundary.
Rust remains authoritative for persistence, validation, EventLog, export, and
append-step mutation. React owns local presentation, direct student editing, and
model/provider selector continuity. Pi/LLM output may draft PRD and rationale
text, but DIVE validates IDs, links, mutation records, and review-card routing.

## Implementation Strategy

1. **Domain contract first**: Add shared TS/Rust-compatible shapes for
   `ProjectSpec`, stable `AcceptanceCriterion`, per-step
   `DecompositionRationale`, `PlanMutation`, and `Objection`. Provide adapters
   that read existing string-array criteria as generated criterion objects.
2. **PRD persistence and versioning**: Persist minimal PRD content before first
   decomposition. Record version snapshots or deltas for authored/edited PRDs
   and include the current PRD in `.dive/plan.json`/`.dive/plan.md` exports.
3. **Onboarding bridge**: Update `GetStartedChecklist` and its controller model
   so project/provider setup routes into PRD authoring before plan/session.
4. **PRD patch contract**: Add `InterviewTurn`, `PrdPatch`, validation, merge,
   conflict handling, criterion ID assignment, and EventLog/export records before
   wiring model output into the board.
5. **PRD Authoring Board**: Replace/elevate `SocraticInterviewPanel` into a
   bounded PRD Authoring Board with header, interview rail, live PRD canvas, and
   bottom action bar. Restore the same model/provider selector available in
   normal chat and keep the required fields small enough to avoid wizard
   behavior.
6. **Final PRD read view**: Add the saved/completed PRD surface with compact
   goal, acceptance criteria, scope boundary, constraints, version, edit, and
   create-plan actions. Keep authoring rail/patch UI out of this view.
7. **Criterion-linked decomposition**: Update plan generation decoding, Rust
   validation, artifacts, and UI rendering so every step has at least one linked
   criterion ID plus rationale. Reject or hold drafts that cannot be traced to
   the PRD.
8. **Challenge path**: Add "why this step?" / objection affordance on the plan
   and step detail surfaces. Log objections and optionally offer a non-blocking
   re-decomposition suggestion.
9. **Dedicated add-step area**: Surface one-action add-step flow in the plan
   area. Back it with `workspace_plan_append_step`, update PRD version/mutation
   state, and prevent chat from silently mutating the plan.
10. **Scope-expansion card integration**: Add deterministic comparison between
   new step and PRD scope/criteria. If expansion is detected, invoke specs/002
   review-card path as non-blocking contextual feedback near the add-step area.
11. **Export and QA**: Extend EventLog/export sanitization tests, PRD artifact
   export tests, TypeScript decoder tests, and UI tests for contextual placement
   and selector preservation.

## Risks And Mitigations

- **Overbuilding the PRD surface into a wizard**: Mitigated by a required
  minimal field set and direct editability after creation.
- **Breaking existing plans that store criteria as strings**: Mitigated by
  read adapters that assign stable generated IDs during migration and write the
  new object form only after user-visible mutation.
- **LLM rationale sounds plausible but is not grounded**: Mitigated by DIVE
  validation requiring criterion IDs and by displaying the criteria beside the
  rationale.
- **Plan mutations become hidden chat history**: Mitigated by requiring
  dedicated-area confirmation and EventLog/PRD version records for every add or
  change.
- **Scope-expansion cards duplicate specs/002/003 authority**: Mitigated by
  keeping 004 responsible only for deterministic scope comparison and using the
  existing SupervisorAgent/card presentation contracts for card content/UI.

## Post-Design Constitution Check

- **Real workflow**: Pass. All surfaces are PRD, plan, step, or verification
  lifecycle surfaces for the student's actual project.
- **Evidence**: Pass. Interventions rely on PRD/criteria/step/mutation state
  and concrete scope comparison, not generic warnings.
- **Pi-only runtime**: Pass. No runtime fallback or new model-visible tools are
  introduced.
- **Local ledger**: Pass. EventLog/export contracts cover PRD versions,
  mutations, rationale challenges, and scope-review outcomes.
- **Low-friction supervision**: Pass. Minimal PRD is required; all other
  challenge/replanning surfaces are non-blocking and contextual.
- **Typed/testable seams**: Pass. Data model and IPC contracts define typed
  seams, and quickstart scenarios map them to deterministic unit/UI/export
  tests.

No constitution violations are introduced by the design.

## Complexity Tracking

No constitution violations or extra project structures are required.
