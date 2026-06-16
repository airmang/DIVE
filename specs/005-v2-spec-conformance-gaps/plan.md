# Implementation Plan: V2 Spec Conformance Gaps

**Branch**: `005-v2-spec-conformance-gaps` | **Date**: 2026-06-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/005-v2-spec-conformance-gaps/spec.md`

## Summary

Close the remaining v2 conformance gaps discovered after FR-023 review:
remove user-visible legacy runtime fallback, move add-step scope-expansion
review cards onto the dedicated SupervisorAgent path, make rationale challenges
offer a non-blocking plan-adjustment next action, and update active spec status
so future agents can distinguish shipped behavior from future/reserved
contracts. The implementation keeps the current repository and UI baseline,
uses the existing Rust/Tauri supervision boundary, EventLog/export path, and
React plan surfaces, and avoids broad rewrites.

## Technical Context

**Language/Version**: Rust 1.80 / edition 2021; TypeScript 5.8; React 19.1;
Vite 7; Tauri 2.

**Primary Dependencies**: Existing `rusqlite`, `serde`/`serde_json`, Tauri IPC,
React Testing Library, Vitest, Pi sidecar runtime, and current provider/runtime
abstractions. No new runtime dependency is planned.

**Storage**: Existing local SQLite database and EventLog/export path. Reuse
existing supervisor evaluation records where possible; add small typed payload
fields or rows only when needed for runtime capability blocks and
plan-adjustment offer reconstruction.

**Testing**: `cargo test` under `dive/src-tauri`; targeted Rust tests for
runtime selection, supervisor validation, scope-expansion evaluation, and
EventLog/export; targeted Vitest suites for add-step scope cards, rationale
challenge offers, runtime labels/capability messaging, and card UX regressions;
`pnpm typecheck`; `pnpm test:unit`.

**Target Platform**: DIVE desktop app for local/classroom use with bundled Pi
sidecar and local-first project state.

**Project Type**: Desktop application with Rust/Tauri backend, React frontend,
and bundled Node-based Pi sidecar.

**Performance Goals**: Runtime capability checks complete before a work turn
starts; add-step scope review remains non-blocking and must fail open to no
card plus log on supervisor timeout; rationale challenge logging and offer
creation complete within ordinary local UI latency.

**Constraints**: No user-visible legacy runtime fallback; no provider fallback
routing; no static review-card fallback; no frontend-authored review-card
questions for scope expansion; no silent plan mutation from chat or rationale
challenge; preserve existing DIVE UI/UX unless the spec explicitly changes a
conformance gap.

**Scale/Scope**: One active project/plan/session at a time in the current
workspace-plan model. This feature repairs runtime selection, one add-step
scope-review path, rationale challenge offers, and status documentation; it
does not implement full change-step or retire-step plan mutation UI.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Real workflow**: Pass. The feature operates inside real DIVE work:
  execution start, add-step planning during Verify/Extend, and step-rationale
  review in the plan/step detail surface. It adds no lesson, quiz, or detached
  card deck.
- **Evidence**: Pass. Runtime blocks are grounded in provider/Pi capability
  state. Scope cards are grounded in PRD criteria, add-step fields, and
  deterministic reason codes. Rationale offers are grounded in a specific
  objection, step, and linked criteria.
- **Pi-only runtime**: Pass. The primary objective removes legacy runtime
  fallback and replaces unsupported runtime/provider cases with explicit
  capability states.
- **Local ledger**: Pass. Runtime capability decisions, scope supervisor
  evaluations, shown/dropped/no-card outcomes, review card responses,
  rationale objections, and plan-adjustment offer responses are logged/exported.
- **Low-friction supervision**: Pass. New friction only appears when execution
  would violate the Pi-only runtime boundary or when deterministic
  scope-expansion evidence exists. Rationale challenge offers are non-blocking.
- **Typed/testable seams**: Pass. Runtime capability state, scope-expansion
  supervisor events, plan-adjustment offers, and spec-conformance status records
  are explicit contracts with deterministic tests for triggers, validation,
  drop rules, and export.

No constitution violations are required.

## Phase 0 Research Summary

Research decisions are recorded in [research.md](./research.md). The selected
approach is:

- Treat legacy runtime requests and providers without confirmed Pi capability as
  explicit blocked capability states in v2 work turns.
- Keep existing provider parity descriptors as the source of Pi capability, but
  stop using missing parity as a reason to execute legacy behavior.
- Add a supervisor event for add-step `scope_expansion` review, triggered only
  after DIVE's deterministic scope assessment produces evidence refs.
- Reuse the existing SupervisorAgent validation/mapping/logging path for
  scope-expansion cards instead of frontend rule-card generation.
- Make rationale challenge offers deterministic and local-first: a valid
  objection creates an `offered` plan-adjustment next action, but no plan change
  occurs until the student confirms in the dedicated plan area.
- Keep `change_step` and `retire_step` as future/contract-reserved until a
  later feature defines visible mutation paths.

## Phase 1 Design Summary

Design artifacts generated for this plan:

- [data-model.md](./data-model.md): runtime capability state,
  scope-expansion review event, rationale objection/offer, and spec
  conformance record entities.
- [contracts/runtime-capability.md](./contracts/runtime-capability.md):
  runtime selection and unavailable-state contract.
- [contracts/scope-expansion-supervisor.md](./contracts/scope-expansion-supervisor.md):
  add-step scope supervisor event, evidence, validation, and no-fallback rules.
- [contracts/rationale-challenge.md](./contracts/rationale-challenge.md):
  objection logging and non-blocking plan-adjustment offer contract.
- [contracts/event-log-export.md](./contracts/event-log-export.md):
  required EventLog/export records and redaction expectations.
- [quickstart.md](./quickstart.md): validation scenarios and commands for
  implementation.

## Project Structure

### Documentation (this feature)

```text
specs/005-v2-spec-conformance-gaps/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── runtime-capability.md
│   ├── scope-expansion-supervisor.md
│   ├── rationale-challenge.md
│   └── event-log-export.md
└── tasks.md
```

### Source Code (repository root)

```text
dive/
├── src/
│   ├── components/chat/
│   │   └── ToolActivity.tsx                    # preserve permission-card behavior
│   ├── components/product/
│   │   ├── PlanAddStepPanel.tsx                # scope review placement
│   │   ├── PlanDashboardPanel.tsx              # dedicated add-step area
│   │   ├── StepDetailSlideIn.tsx               # rationale challenge offer
│   │   └── useProductShellController.ts        # challenge/add-step orchestration
│   ├── components/shell/
│   │   └── RuntimeBadge.tsx                    # supervised/runtime state label
│   ├── features/planning/
│   │   ├── types.ts
│   │   └── usePlan.ts
│   └── features/provocation/
│       ├── adapters.ts                         # supervisor invoke/response adapters
│       ├── logging.ts
│       ├── rules.ts                            # remove scope card shipped usage
│       └── types.ts
├── src-tauri/
│   ├── src/
│   │   ├── db/models.rs                        # typed runtime/offer payloads if needed
│   │   ├── dive/
│   │   │   ├── event_log.rs
│   │   │   └── supervisor.rs
│   │   ├── ipc/
│   │   │   ├── chat.rs                         # runtime capability selection
│   │   │   ├── provocation_agent.rs            # supervisor evaluation events
│   │   │   └── workspace_plan.rs               # rationale/add-step flows
│   │   ├── pi_sidecar/
│   │   │   └── parity.rs                       # Pi capability descriptors
│   │   └── workspace_plan/
│   │       └── artifacts.rs                    # export reconstruction
│   └── tests/
└── pi-sidecar/
    └── src/index.mjs                           # no new tools/resource discovery
```

**Structure Decision**: Keep the current Tauri/React workspace-plan boundary.
Rust remains authoritative for runtime capability decisions, supervisor
context/validation, EventLog, export, and plan mutation persistence. React owns
local presentation and user confirmation. The Pi sidecar remains the only
model runtime for supervisor review questions and must not gain tools/resource
discovery for this feature.

## Implementation Strategy

1. **Runtime conformance first**: Replace user-visible `Legacy` runtime
   selection with explicit unavailable states for ineligible providers or legacy
   overrides. Keep any old AgentLoop code only as migration/internal code that
   cannot be selected for v2 user work.
2. **Runtime ledger**: Add or standardize EventLog/export records for
   supervised runtime selection and blocked capability states.
3. **Scope event contract**: Extend supervisor domain types to support a
   `scope_expansion` event with artifact refs and evidence refs derived from
   the add-step deterministic assessment.
4. **No static scope card**: Remove shipped add-step usage of frontend rule-card
   generation. Supervisor failure or invalid output produces no card plus log.
5. **Add-step UI wiring**: Keep the card near the add-step panel and
   non-blocking. Card actions may help link criteria or split scope, but cannot
   silently mutate the plan.
6. **Rationale challenge offer**: Persist objections as today, then create a
   non-blocking `offered` state and visible plan-adjustment action. Accepting
   the offer routes into a reviewable plan-area suggestion path.
7. **Status truthfulness**: Update `specs/README.md`, `docs/spec-status.md`,
   and affected feature notes so checked task lists do not overstate shipped
   behavior. Label `change_step`/`retire_step` as future/reserved unless this
   feature implements a visible path.
8. **Regression validation**: Run targeted Rust/Vitest suites plus typecheck,
   unit tests, export checks, and quickstart scenarios.

## Risks And Mitigations

- **Provider parity disruption**: Blocking legacy fallback may expose providers
  that previously appeared to work. Mitigate with explicit setup/capability
  copy and tests for each provider category.
- **Supervisor latency around add-step**: Scope cards are non-blocking and fail
  open to no card plus log, so adding a step remains low-friction.
- **Static rule-card code still imported elsewhere**: Quarantine or remove only
  shipped scope-card usage in this feature; broader removal stays a separate
  product decision unless a direct conformance conflict is found.
- **Rationale challenge becoming hidden chat mutation**: The offer routes to a
  dedicated plan-area confirmation path and never mutates the plan silently.
- **Spec-status drift**: Completion tasks must update canonical index/status
  docs alongside code validation.

## Complexity Tracking

No constitution violations or extra architectural complexity are required.
