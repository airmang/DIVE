# DIVE Spec Status

**Last updated**: 2026-06-17

This file prevents agents from treating old design notes as active product
authority. The canonical DIVE v2 source of truth lives in `.specify/` and
`specs/`.

## Canonical Active Specs

| Path | Status | Use |
| --- | --- | --- |
| `.specify/memory/constitution.md` | Canonical | Governs all DIVE v2 work. |
| `specs/README.md` | Canonical | Explains active spec authority and current spec set. |
| `specs/001-dive-v2-foundation/spec.md` | Canonical | Defines v2 product boundaries, non-goals, and repo strategy. |
| `specs/001-dive-v2-foundation/decisions.md` | Canonical | Records v2 foundation decisions. |
| `specs/002-provocation-supervisor-agent/spec.md` | Canonical | Defines dedicated Pi SupervisorAgent behavior for review cards. |
| `specs/002-provocation-supervisor-agent/decisions.md` | Canonical | Records provocation supervisor decisions. |
| `specs/002-provocation-supervisor-agent/implementation-gap.md` | Canonical planning aid | Tracks current implementation keep/remove/improve alignment for P1. |
| `specs/003-supervision-card-ux/spec.md` | Canonical | Defines supervision card presentation/IA (focal criterion, review-vs-permission distinction); presentation only. |
| `specs/003-supervision-card-ux/decisions.md` | Canonical | Records supervision card UX/IA decisions. |
| `specs/004-prd-decompose-lifecycle/spec.md` | Canonical | Elevates onboarding into PRD authoring via a dedicated PRD Authoring Board with validated turn-by-turn PRD patches and a concise completed PRD read view; criterion-linked decomposition; mid-flow step add; living PRD. |
| `specs/004-prd-decompose-lifecycle/decisions.md` | Canonical | Records PRD/decompose lifecycle decisions. |
| `specs/004-prd-decompose-lifecycle/plan.md` | Canonical planning aid | Defines implementation plan, architecture, and test strategy for the PRD/decompose lifecycle. |
| `specs/004-prd-decompose-lifecycle/research.md` | Canonical planning aid | Records design decisions for PRD persistence, criteria IDs, rationale storage, add-step flow, and scope-expansion gating. |
| `specs/004-prd-decompose-lifecycle/data-model.md` | Canonical planning aid | Defines ProjectSpec, AcceptanceCriterion, DecompositionRationale, PlanMutation, PRD delta, scope assessment, and Objection entities. |
| `specs/004-prd-decompose-lifecycle/contracts/` | Canonical planning aid | Defines IPC, UI lifecycle, and EventLog/export contracts for 004. |
| `specs/004-prd-decompose-lifecycle/quickstart.md` | Canonical planning aid | Defines validation scenarios and commands for the 004 implementation phase. |
| `specs/004-prd-decompose-lifecycle/tasks.md` | Canonical planning aid | Defines dependency-ordered implementation tasks for 004, organized by independently testable user story. |
| `specs/005-v2-spec-conformance-gaps/spec.md` | Canonical | Defines the remaining v2 conformance cleanup scope: no legacy runtime fallback, SupervisorAgent-backed add-step scope cards, rationale challenge offers, and truthful active spec status. |
| `specs/005-v2-spec-conformance-gaps/plan.md` | Canonical planning aid | Defines implementation plan, architecture, and test strategy for 005. |
| `specs/005-v2-spec-conformance-gaps/research.md` | Canonical planning aid | Records decisions for runtime capability blocking, scope-expansion supervisor events, rationale challenge offers, and future/reserved mutation scope. |
| `specs/005-v2-spec-conformance-gaps/data-model.md` | Canonical planning aid | Defines RuntimeCapabilityState, ScopeExpansionReviewEvent, RationaleObjection, PlanAdjustmentOffer, and SpecConformanceRecord. |
| `specs/005-v2-spec-conformance-gaps/contracts/` | Canonical planning aid | Defines runtime capability, scope supervisor, rationale challenge, and EventLog/export contracts. |
| `specs/005-v2-spec-conformance-gaps/quickstart.md` | Canonical planning aid | Defines validation scenarios and commands for 005. |
| `specs/005-v2-spec-conformance-gaps/tasks.md` | Canonical planning aid | Defines dependency-ordered implementation tasks for 005, including the shared foundation tracked by Wily Stage S-016. |
| `specs/006-sarkar-provocation-expansion/spec.md` | Canonical | Defines planned expansion of Sarkar-style review-card coverage to plan draft approval, diff-ready review, and retry-loop review. |
| `specs/006-sarkar-provocation-expansion/plan.md` | Canonical planning aid | Defines implementation plan, architecture, and test strategy for 006. |
| `specs/006-sarkar-provocation-expansion/research.md` | Canonical planning aid | Records decisions for reusing `provocation_agent_evaluate`, deterministic assessments, artifact-adjacent rendering, EventLog reuse, step-scoped retry loops, and action allowlist expansion. |
| `specs/006-sarkar-provocation-expansion/data-model.md` | Canonical planning aid | Defines expanded supervisor events, artifact refs, plan-draft/diff-ready/retry-loop assessments, expanded cards, and supervisor evaluation logs. |
| `specs/006-sarkar-provocation-expansion/contracts/` | Canonical planning aid | Defines request, response, validation, EventLog, export, and UI placement contracts for expanded supervisor events. |
| `specs/006-sarkar-provocation-expansion/quickstart.md` | Canonical planning aid | Defines validation scenarios and commands for 006. |
| `specs/006-sarkar-provocation-expansion/tasks.md` | Canonical planning aid | Defines dependency-ordered implementation tasks for 006, organized by independently testable user story. |
| `specs/006-sarkar-provocation-expansion/checklists/requirements.md` | Canonical planning aid | Validates 006 specification completeness before planning. |
| `specs/007-llm-verification-coach/spec.md` | Active draft | Defines adaptive AI verification coaching in step review, criterion-linked user observation evidence, and evidence-aware approval separation from AI self-report. |
| `specs/007-llm-verification-coach/plan.md` | Canonical planning aid | Defines implementation plan, architecture, and test strategy for the verification coach. |
| `specs/007-llm-verification-coach/research.md` | Canonical planning aid | Records decisions separating coach guidance from review cards and approval evidence. |
| `specs/007-llm-verification-coach/data-model.md` | Canonical planning aid | Defines VerificationCoachingEvent, VerificationGuide, ObservationEvidence, GuidanceValidationResult, and EvidenceBackedDecision. |
| `specs/007-llm-verification-coach/contracts/` | Canonical planning aid | Defines guidance generation, observation evidence, and EventLog/export contracts. |
| `specs/007-llm-verification-coach/quickstart.md` | Canonical planning aid | Defines validation scenarios and commands for 007. |
| `specs/007-llm-verification-coach/tasks.md` | Canonical planning aid | Defines dependency-ordered implementation tasks for 007, with MVP focus on guidance plus observation-backed approval. |
| `specs/008-preview-terminal-runtime-tools/spec.md` | Active draft | Defines first-class Preview, direct Project Command, and bounded Terminal Script runtime actions for preview and verification work. |
| `specs/008-preview-terminal-runtime-tools/plan.md` | Canonical planning aid | Defines implementation plan, architecture, and test strategy for 008. |
| `specs/008-preview-terminal-runtime-tools/research.md` | Canonical planning aid | Records decisions for first-class Preview, direct Project Command, Terminal Script separation, preview rerouting, stale approvals, and EventLog/export reuse. |
| `specs/008-preview-terminal-runtime-tools/data-model.md` | Canonical planning aid | Defines PreviewRequest, PreviewSession, ProjectCommandRequest, TerminalScriptRequest, RuntimeRoutingDecision, ExecutionEvidence, and StaleApprovalState. |
| `specs/008-preview-terminal-runtime-tools/contracts/` | Canonical planning aid | Defines Preview, Project Command routing, Terminal Script, and EventLog/export contracts. |
| `specs/008-preview-terminal-runtime-tools/quickstart.md` | Canonical planning aid | Defines validation scenarios and commands for 008. |
| `specs/008-preview-terminal-runtime-tools/checklists/requirements.md` | Canonical planning aid | Validates 008 specification completeness before planning. |

## 008 Draft Scope

As of 2026-06-17, `specs/008-preview-terminal-runtime-tools/` defines the next
runtime-tool boundary after the `index.html` preview approval issue. Preview
inspection is separated from project command execution; ordinary tests and
builds remain direct executable commands with explicit arguments; shell-style
terminal scripts are reserved for a distinct high-risk path with stronger
approval, blocking, logging, and export semantics.

The 008 implementation plan and design artifacts have been generated. The MVP
order is Preview routing and stale approval cleanup first, Project Command
guard/reroute hardening second, and Terminal Script as a separate high-risk
vertical slice.

## 006 Specification Status

As of 2026-06-16, `specs/006-sarkar-provocation-expansion/` is implemented by
Wily Stage S-022. The implementation adds SupervisorAgent-backed
`plan_drafted`, `diff_ready`, and `retry_loop` review-card events, preserves
no-static-fallback behavior, keeps cards artifact-adjacent and non-blocking,
and logs/exports shown, silent, and dropped expanded evaluations through the
local EventLog/export path. It extends the
`specs/002-provocation-supervisor-agent/` SupervisorAgent architecture and
preserves the `specs/003-supervision-card-ux/` presentation constraints plus
the `specs/005-v2-spec-conformance-gaps/` `scope_expansion` behavior.

| Wily Stage | Scope | Status |
| --- | --- | --- |
| S-022 | T001-T065 006 Sarkar-style plan-draft, diff-ready, retry-loop, EventLog/export, regression, and validation handoff | Done |

S-022 validation evidence is recorded in
`specs/006-sarkar-provocation-expansion/quickstart.md`. Final validation passed
with `pnpm typecheck`, `pnpm test:unit`, and full `cargo test`.

## 007 Draft Scope

As of 2026-06-17, `specs/007-llm-verification-coach/` is being implemented by
Wily Stage S-023. The feature addresses manual/CLI/no-preview verification
ambiguity discovered while testing `DIVE_TEST9`. It is intentionally separate
from Sarkar/provocation review-card expansion: review cards remain governed by
the SupervisorAgent specs, while 007 defines verification guidance and
criterion-linked user-observation evidence inside the step review decision
flow.

## 007 Implementation Status

As of 2026-06-17, Wily Stage S-023 has implemented the verification coach
foundation, step-review guidance panel, criterion-linked observation capture,
manual-observation approval provenance, guide regeneration/version correlation,
and EventLog/export sanitization. AI guidance remains guidance only: it is
logged/exportable but does not count as verification evidence. Normal
evidence-backed approval requires an automated pass or criterion-linked user
observation.

S-023 validation passed `pnpm typecheck`, targeted Vitest suites, full
`pnpm test:unit`, targeted Rust verification/provenance/export tests, and
`cargo test export --quiet`. The DIVE_TEST9 Step 1 Tauri app smoke was not run
because this environment did not include an automated DIVE_TEST9 review-flow
harness or copied real-provider DB/keyring smoke fixture. Detailed validation
results are recorded in `specs/007-llm-verification-coach/quickstart.md`.

## 005 Implementation Status

As of 2026-06-16, `specs/005-v2-spec-conformance-gaps/` has implemented the
conformance cleanup tracked by Wily Stages S-016 through S-020. It closes gaps
found after 002/003/004 implementation review without expanding the visible
mutation surface beyond the implemented `add_step` path.

| Gap | Status |
| --- | --- |
| User-visible legacy runtime fallback still selectable for v2 work | Closed in S-017: v2 work reports supervised Pi readiness or an explicit unavailable capability state; legacy requests are blocked rather than shown as a successful runtime. |
| Add-step scope-expansion review card generated by frontend rule card instead of SupervisorAgent path | Closed in S-018: add-step scope cards use the dedicated SupervisorAgent path with DIVE-owned evidence validation; invalid, unavailable, timed-out, or duplicate outcomes log no-card/drop results with no static fallback. |
| Step-rationale challenge logs objection but does not offer plan adjustment/re-decomposition | Closed in S-019: objections are logged/exportable and now produce non-blocking plan-adjustment offers that route to reviewable plan-area suggestions without silently mutating the plan. |
| `change_step` / `retire_step` mutation behavior reserved in contracts but easy to misread as shipped | Clarified in S-020: these remain future/contract-reserved unless a later spec implements a visible path. The shipped 004/005 plan-mutation behavior is `add_step`. |
| 003 card UX status needs truthful completion/harmonization accounting | Clarified in S-020: 003 remains the active presentation/IA authority. Previously implemented review-card presentation work is the baseline, while broad permission-card harmonization remains active/future unless separately validated. |

| Wily Stage | Scope | Status |
| --- | --- | --- |
| S-016 | T001-T015 shared copy, types, Rust models, EventLog/export, supervisor contract, and status setup | Done |
| S-017 | T016-T027 no user-visible legacy runtime fallback | Done |
| S-018 | T028-T041 add-step scope-expansion SupervisorAgent path | Done |
| S-019 | T042-T054 rationale challenge plan-adjustment offers | Done |
| S-020 | T055-T062 shipped-vs-future documentation checks and canonical status truth update | Done |

S-020 validation evidence is recorded in
`specs/005-v2-spec-conformance-gaps/quickstart.md`. The docs regression guard is
`cargo test --test spec_status_docs` from `dive/src-tauri/`, plus the grep
checks listed in the 005 quickstart.

## 004 Implementation Status

As of 2026-06-15, `specs/004-prd-decompose-lifecycle/` is implemented through
the PRD domain foundation, PRD Authoring Board MVP, criterion-linked
decomposition/rationale challenge, and dedicated add-step/scope-review slices.
Final validation and handoff are tracked by Wily Stage S-015 and tasks
T065-T070.

| Wily Stage | Scope | Status |
| --- | --- | --- |
| S-011 | T001-T015 PRD contracts, validation, persistence, EventLog, export foundation | Done |
| S-012 | T016-T034 PRD onboarding, authoring board, read view, PRD IPC/logging | Done |
| S-013 | T035-T051 criterion-linked decomposition and rationale challenge | Done |
| S-014 | T052-T064 dedicated add-step mutation, scope assessment, review-card integration, export | Done |
| S-015 | T065-T070 quickstart/status docs, typecheck, unit tests, Rust tests, quickstart validation | Done |

S-015 did not add product scope. Validation passed with `pnpm typecheck`,
`pnpm test:unit`, required plain `cargo test`, extended
`cargo test --features dev-mock`, and a browser smoke of the first-run PRD
onboarding step. The only fix was a S-015 test-harness configuration change:
MockProvider integration test targets now declare `required-features =
["dev-mock"]` in `dive/src-tauri/Cargo.toml`.

## Root Legacy Specs

| Path | Status | Notes |
| --- | --- | --- |
| `DIVE_SPEC.md` | Historical reference | Earlier broad product spec. Do not implement v2 behavior directly from it. |
| `DIVE_DECISIONS.md` | Historical ADR ledger | Keep for rationale archaeology. Active v2 conflicts are resolved by spec-kit decisions. |
| `DIVE_PLAN.md` | Historical reference | Not active for v2 planning. |

## Superseded Superpowers Specs

These files may contain useful context, but they are not active implementation
authority unless an active spec explicitly incorporates a specific section.

| Path | Status | Canonical replacement or use |
| --- | --- | --- |
| `docs/superpowers/specs/2026-05-30-dive-frontend-stage-removal-design.md` | Superseded | Historical only. |
| `docs/superpowers/specs/2026-05-30-dive-honest-verification-design.md` | Superseded | Evidence principles incorporated into constitution and active specs. |
| `docs/superpowers/specs/2026-05-30-dive-judgmental-approval-design.md` | Superseded | Historical only; active review-card behavior governed by specs/002. |
| `docs/superpowers/specs/2026-05-30-dive-supervision-mental-model-decision-design.md` | Historical reference | May inform research framing only. |
| `docs/superpowers/specs/2026-05-30-dive-supervision-metrics-design.md` | Historical reference | May inform export analysis only after active spec approval. |
| `docs/superpowers/specs/2026-05-30-dive-trust-calibration-steering-design.md` | Superseded | Active supervision constraints are in constitution/specs/002. |
| `docs/superpowers/specs/2026-06-04-dive-large-project-runtime-pi-embed-design.md` | Historical implementation context | Pi context only; v2 runtime authority is constitution/specs/001. |
| `docs/superpowers/specs/2026-06-05-dive-plan-surface-redesign-design.md` | Historical UI context | Existing UI/UX baseline only; not active redesign authority. |
| `docs/superpowers/specs/2026-06-07-dive-unified-get-started-design.md` | Historical UI context | Not active v2 implementation authority. |
| `docs/superpowers/specs/2026-06-08-dive-console-design-language-design.md` | Historical UI context | May inform visual consistency only if active spec references it. |
| `docs/superpowers/specs/2026-06-14-provocation-agent-design.md` | Promoted/superseded | Promoted into `specs/002-provocation-supervisor-agent/spec.md`; do not implement directly from this file. |
| `docs/superpowers/specs/2026-06-14-provocation-quality-reframe-design.md` | Voice seed only | May provide few-shot tone examples for SupervisorAgent; no static fallback behavior. |

## Superseded Superpowers Plans

These plans are implementation history. They must not be used as active task
lists for v2.

| Path | Status | Notes |
| --- | --- | --- |
| `docs/superpowers/plans/2026-05-11-phase-10-computer-use-qa.md` | Historical | Not active. |
| `docs/superpowers/plans/2026-05-11-phase-10-kickoff-hardening.md` | Historical | Not active. |
| `docs/superpowers/plans/2026-05-30-dive-frontend-stage-removal.md` | Superseded | Not active. |
| `docs/superpowers/plans/2026-05-30-dive-honest-verification.md` | Superseded | Evidence principles retained in active specs. |
| `docs/superpowers/plans/2026-05-30-dive-judgmental-approval.md` | Superseded | Not active for v2 review-card implementation. |
| `docs/superpowers/plans/2026-05-30-dive-plan-first-unification.md` | Historical | Not active. |
| `docs/superpowers/plans/2026-05-30-dive-supervision-metrics.md` | Historical | Research context only. |
| `docs/superpowers/plans/2026-05-30-dive-trust-calibration-steering.md` | Superseded | Not active. |
| `docs/superpowers/plans/2026-06-04-dive-demo-pilot-truth-hardening.md` | Historical | Not active. |
| `docs/superpowers/plans/2026-06-04-dive-large-project-runtime-pi-embed.md` | Historical implementation context | Do not override v2 Pi-only direction. |
| `docs/superpowers/plans/2026-06-07-dive-unified-get-started.md` | Historical | Not active. |
| `docs/superpowers/plans/2026-06-08-console-design-language.md` | Historical UI context | Not active unless referenced by a new UI spec. |
| `docs/superpowers/plans/2026-06-08-dive-pi-default-runtime-flip.md` | Superseded for v2 runtime policy | Contains old legacy-fallback plan; v2 policy is no user-visible legacy fallback. |
| `docs/superpowers/plans/2026-06-13-dive-human-agency-alignment.md` | Historical reference | Not active. |
| `docs/superpowers/plans/2026-06-13-dive-provocation-cards-remediation.md` | Superseded | Replaced by specs/002. |
| `docs/superpowers/plans/2026-06-13-dive-provocation-redesign.md` | Superseded | Replaced by specs/002. |
| `docs/superpowers/plans/2026-06-13-dive-s009-provocation-card-followups.md` | Superseded | Replaced by specs/002. |

## Rule For Agents

If a non-canonical document conflicts with a canonical spec, follow the
canonical spec. If a needed behavior is missing from canonical specs, pause and
update the relevant `specs/*/spec.md` or `decisions.md` before implementing.
