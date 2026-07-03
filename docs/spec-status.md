# DIVE Spec Status

**Last updated**: 2026-07-03

This file prevents agents from treating old design notes as active product
authority. The canonical DIVE v2 source of truth lives in `.specify/` and
`specs/`. Superseded design docs, legacy root specs, and pre-spec-kit plans
were relocated to `docs/archive/` in the 2026-07-03 doc cleanup (see the
archived-status sections below).

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
| `specs/010-beginner-readiness-ux/spec.md` | Canonical | Defines the post-rc.5 round-2 beginner-readiness/UX hardening scope (8 themes → Wily Stages S-041–S-048). |
| `specs/010-beginner-readiness-ux/design-s041.md` … `design-s048.md` | Canonical planning aids | Per-stage designs for the eight 010 stages. |
| `specs/010-beginner-readiness-ux/adr-s048-network-egress.md` | Accepted ADR | Constitution 1.0.0→1.1.0 amendment admitting the Rust-validated network-egress capability class (Principle III). |

## 010 Implementation Status

As of 2026-07-02, `specs/010-beginner-readiness-ux/` (post-rc.5 round-2
beginner-readiness/UX hardening) is implemented by Wily Stages S-041 through
S-048 on branch `010-beginner-readiness-ux`. Stages S-041 through S-047 each
landed with local CI green plus a live re-QA pass on the rebuilt release app
(evidence in `docs/qa/round2-live-qa-run-log.md`).

| Wily Stage | Scope | Status |
| --- | --- | --- |
| S-041 | PRD interview honesty/dead-end fix, criterion scaffolding, confirmable-gate routing (theme 1) | Done |
| S-042 | Anti-automation-bias hardening: offline verify-provocation, high-risk read gate, review-card honesty (theme 2) | Done |
| S-043 | Korean-parity i18n sweep (theme 3) | Done |
| S-044 | WCAG AA contrast + a11y semantics (theme 4) | Done |
| S-045 | Beginner vocabulary & first-run framing, Safe/Warn/Danger primer (theme 5) | Done |
| S-046 | Error/recovery legibility, loading states, composer gating (theme 6) | Done |
| S-047 | Mandatory student architecture decision in the PRD interview (theme 7, owner-added) | Done |
| S-048 | Supervised agent web access: DIVE-owned `web_fetch` + Rust egress guard under Constitution III(1.1.0) (theme 8, owner-added) | Done |
| S-049 | 010 deferred-tail closeout: P2-38 preview-log i18n, `--color-info` AA token, S-047 Q2 form-scaffolding + non-blocking form-consistency EventLog annotation, S-045 primer EventLog | Done |

S-049 closes the four items the S-043/S-044/S-045/S-047 designs explicitly
deferred to a follow-up: (P2-38) `preview.rs` reuse strings became a
`ReusedPreviewLogCode` enum localized in `PreviewTab` via `slide_in.preview.reused.*`;
(a11y) light `--color-info` `56 104 200`→`40 90 180` clears the info/15 badge
composite at 4.66:1 AA (dark mode untouched), locked by two new `contrast.test`
cases; (S-047 Q2) `buildPrdPlanGenerationPrompt` injects a deterministic per-form
scaffolding block and a deterministic non-blocking `plan_form_consistency`
annotation is logged to the EventLog (`plan.form_consistency`) with no user-facing
card or gate; (S-045) a prefix-guarded `log_ui_event` IPC records
`permission_primer.shown`/`.dismissed` (variant `generic|web_fetch`), shown-once.
The **process-tool plain-GET egress hardening (S-048 decision 6b) is NOT part of
S-049** — it is tracked separately (below) and worked in its own session.

S-048 security posture: `web_fetch` is the first SSRF-validated egress path —
resolved-IP denylist including IPv6 embeddings (IPv4-mapped, NAT64, 6to4,
Teredo), DNS-rebind pinning to the exact validated IP, a manual per-hop
redirect re-validation loop (`redirect::Policy::none()`), 3 MiB on-the-wire /
5 s connect / 25 s total-deadline bounds with decompression disabled, GET-only
and https-only, `RiskLevel::Danger` with a web-specific beginner approval card
(host + resolved IP as the trust anchor, model-authored purpose labeled
unverified), Build-run-mode-only exposure with a permission backstop, and
query-string-dropped/hashed-path EventLog export. Web content is agent input,
never verification evidence: the closed `ExecutionEvidenceSource` set has no
web variant.

**Tracked follow-up (S-048 locked decision 6b — egress hardening)**: plain
outbound GET via the process tool (`curl -o … https://x`, permitted by
`classify_bash_command`) remains un-SSRF-guarded. Per Constitution III(1.1.0)
it must be tightened or tracked; it is tracked here as an explicit follow-up,
and `web_fetch` must not be described as the "only sanctioned egress" until
that tightening lands.

## 008 Implementation Status

As of 2026-06-18, Wily Stage S-024 has implemented the 008 runtime-tool
boundary through P6 automated validation. Preview inspection is separated from
Project Command execution; ordinary tests and builds remain direct executable
commands with explicit arguments; and shell-style verification is implemented
as the distinct high-risk Terminal Script path with one-shot approval, blocking,
bounded output, logging, and export semantics.

The shipped scope includes static HTML Preview, loopback URL Preview,
configured project preview server responses, Preview rerouting for common
shell-open workarounds, stale approval resolution, direct Project Command
metadata/evidence hardening, and Terminal Script guardrails. Preview
availability remains an inspection surface only: it is not verification
evidence unless later paired with user observation or accepted automated
evidence under the verification specs.

S-024 validation passed frontend typecheck, targeted Vitest suites, full
frontend unit tests, targeted Rust runtime/export/guard suites, `cargo fmt
--check`, full default `cargo test`, and dev-app manual smoke. Manual smoke
found a static HTML blank-screen regression caused by the Tauri asset protocol
not being enabled; S-024 fixed it by enabling the asset protocol and adding
Preview frame CSP coverage for `asset.localhost`. Detailed validation evidence
is recorded in `specs/008-preview-terminal-runtime-tools/quickstart.md`.

Remaining release risk: repeat packaged-app/cross-OS smoke on target classroom
images for filesystem asset protocol scope, local dev-server Preview, direct
command approval, stale approval clicks, and Terminal Script shell-family
availability.

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
| `change_step` / `retire_step` mutation behavior reserved in contracts but easy to misread as shipped | Resolved by S-033 (009 theme 5): both mutations now ship as visible, tested apply IPCs — `retire_step` via the remove path (`workspace_plan_remove_step`, `plan_step_retired` event/export, P3) and `change_step` via the supersede path (`workspace_plan_supersede_step`, `plan_step_changed` event, P4). The shipped 004/005 plan-mutation behaviors are `add_step`, plus `retire_step` and `change_step` shipped under 009 theme 5. |
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

## Root Legacy Specs (archived)

Relocated to `docs/archive/legacy-specs/` in the 2026-07-03 doc cleanup. Kept
for rationale archaeology only; do not implement v2 behavior directly from them.

| Path | Status | Notes |
| --- | --- | --- |
| `docs/archive/legacy-specs/DIVE_SPEC.md` | Historical reference | Earlier broad product spec (still cited as the §2.3 palette / §10.3 serde-contract source in code comments). |
| `docs/archive/legacy-specs/DIVE_PLAN.md` | Historical reference | Legacy Track-0 / rc.1→rc.2 migration plan. Not active for v2 planning. |
| `DIVE_DECISIONS.md` | Historical ADR ledger | Kept at repo root. Active v2 conflicts are resolved by spec-kit decisions. |

## Superseded Superpowers Specs & Plans (archived)

All pre-spec-kit "superpowers" design specs and plans were moved to
`docs/archive/superpowers/{specs,plans}/` in the 2026-07-03 doc cleanup. They
are implementation history and design archaeology only — never active task
lists or implementation authority. If any conflicts with `.specify/` or
`specs/`, the canonical spec wins. `docs/spec-status.md` and `AGENTS.md` govern.

Two files carry a specific active relationship worth noting:

- `docs/archive/superpowers/specs/2026-06-14-provocation-agent-design.md` was
  **promoted** into `specs/002-provocation-supervisor-agent/spec.md`; treat
  specs/002 as authority and this file as historical background only.
- `docs/archive/superpowers/specs/2026-06-14-provocation-quality-reframe-design.md`
  is a **voice seed** — it may provide few-shot tone examples for the
  SupervisorAgent, but implies no static fallback behavior.

## Rule For Agents

If a non-canonical document conflicts with a canonical spec, follow the
canonical spec. If a needed behavior is missing from canonical specs, pause and
update the relevant `specs/*/spec.md` or `decisions.md` before implementing.
