<!--
Sync Impact Report
Version change: 1.0.0 -> 1.1.0 (MINOR): Principle III expanded with a
Rust-validated network-egress capability class (S-048), which also binds
pre-existing process-tool egress to the safe-egress policy; templates reviewed:
plan (updated guidance), spec/tasks (no change). ADR:
specs/010-beginner-readiness-ux/adr-s048-network-egress.md

Prior report (template -> 1.0.0):
Version change: template -> 1.0.0
Modified principles:
- template PRINCIPLE_1_NAME -> I. Real Project Workflow Only
- template PRINCIPLE_2_NAME -> II. Evidence Before Intervention
- template PRINCIPLE_3_NAME -> III. Pi Runtime Is The Only Runtime
- template PRINCIPLE_4_NAME -> IV. Local-First Research Ledger
- template PRINCIPLE_5_NAME -> V. Low-Friction Guided Supervision
- Added principle: VI. Typed Seams And Testable Determinism
Added sections:
- DIVE v2 Product Boundaries
- Development Workflow And Quality Gates
Removed sections:
- Placeholder SECTION_2_NAME and SECTION_3_NAME
Templates requiring updates:
- .specify/templates/plan-template.md - updated
- .specify/templates/spec-template.md - updated
- .specify/templates/tasks-template.md - updated
Follow-up TODOs: none
-->
# DIVE v2 Constitution

## Core Principles

### I. Real Project Workflow Only
DIVE v2 MUST remain a supervised AI coding workflow tool for novice users.
Every product surface MUST operate inside the user's real project workflow:
Decompose, Instruct, Execute, Verify, and Extend. Features MUST NOT turn DIVE
into a quiz app, flashcard app, badge system, standalone card deck, generic
worksheet, or simulated practice environment. New experiences are acceptable
only when they help the user plan, instruct, execute, verify, or extend actual
project work.

Rationale: DIVE teaches supervision by making real AI-assisted coding work
observable and controllable, not by adding classroom theater around it.

### II. Evidence Before Intervention
Warnings, review cards, approval prompts, and supervisor feedback MUST be
grounded in concrete project state such as goals, prompts, plans, permissions,
diffs, terminal output, verification logs, preview observations, or final
approval context. AI self-report MUST NOT be treated as verification evidence.
Generic AI warnings without evidence are prohibited.

Student-facing Korean supervision UI SHOULD use "검토 카드" or "확인 필요 카드".
Review cards MUST appear near the relevant artifact, offer short immediate
actions, allow dismiss and mark-irrelevant actions, and log exposure plus user
response. They MUST NOT appear as ordinary AI chat messages, become quizzes, or
force long-form reflection for ordinary low-risk approvals.

Rationale: Novice users learn the wrong lesson if DIVE interrupts without
evidence or implies that an AI claim is the same as verified project state.

### III. Pi Runtime Is The Only Runtime
DIVE v2 MUST use the Pi runtime as the only agent execution runtime. Legacy
Rust AgentLoop fallback, environment-variable runtime fallback, provider
fallback routing, and compatibility shims that preserve legacy execution are
not allowed in v2 unless a future constitution amendment explicitly restores
them.

Pi MUST run behind DIVE's supervision boundary. Pi built-in tools and resource
discovery MUST be disabled. Only DIVE-owned custom tools may be model-visible,
and every filesystem or process action MUST cross Rust-owned validation,
permission, guard, logging, changed-file, and checkpoint paths before execution.
Node-side custom tools MUST NOT mutate files or spawn processes directly, and
no shell fallback may be introduced for Pi compatibility. Unsupported providers
or missing parity MUST surface as explicit setup or capability states, not as a
silent legacy fallback.

**Network egress (added 1.1.0).** DIVE MAY expose exactly one DIVE-owned,
model-visible network-egress tool for the supervised agent. Its egress MUST
cross Rust-owned validation (safe-egress guard on the DNS-resolved IP, scheme
allowlist, per-hop redirect re-validation, DNS-rebind pinning of the exact
validated IP), permission (explicit per-destination allow/deny surface), guard,
logging, and bounds (connect timeout, total wall-clock deadline, max
on-the-wire response size) before any byte leaves the machine — the identical
crossing discipline required for filesystem/process actions. The same
safe-egress policy MUST also govern any outbound network reachable through the
process tool: pre-existing plain-`curl`/`wget` GET is not exempt from the SSRF
denylist and MUST be tightened or filed as a tracked egress-hardening
follow-up. Pi built-in web/fetch/resource-discovery tools remain disabled;
Node-side / Pi-side direct egress remains forbidden — the network syscall MUST
originate in Rust. Egress is default-deny, opt-in per project and per turn,
least-privilege (GET-only and https-by-default unless a project explicitly opts
in), and MUST fail to a distinct explicit capability state, never a silent
hang. Web-fetched content is agent input, never verification evidence (II): it
MUST NOT satisfy a criterion or pre-approve a step, and the evidence pipeline's
closed `ExecutionEvidenceSource` set MUST NOT gain a web variant. All egress
activity MUST be logged local-first and exportable (IV) with
secrets/tokens/auth headers, full response bodies, and the URL query string
masked, dropped, or bounded.

Rationale: v2 exists to remove old runtime ambiguity. A single runtime boundary
makes supervision, tests, packaging, and classroom behavior auditable.

### IV. Local-First Research Ledger
DIVE v2 MUST preserve local-first state, logging, and exportability. Project
state, workflow events, supervision events, evidence snapshots, review-card
exposures, user responses, dismissals, mark-irrelevant actions, model metadata,
and verification outcomes MUST be auditable through the local EventLog/export
path. Raw secrets, OAuth tokens, and private environment dumps MUST NOT be
written to exportable logs.

Logs MUST separate AI self-report from verification evidence. LLM-generated
supervisor output MUST record the event, summarized input context, decision,
evidence references, model identity, and whether a card was shown or dropped.

Rationale: DIVE is also a research instrument. Later analysis is valid only if
interventions and evidence can be reconstructed without cloud-only state.

### V. Low-Friction Guided Supervision
Work Mode MUST remain low-friction. DIVE may add friction only for high-risk,
ambiguous, or unverified states that are grounded in evidence. Guided Mode MAY
offer more explanation, but it MUST still operate on the user's real project
artifacts and MUST NOT become a separate lesson track.

Supervisor interventions MUST be contextual annotations or nearby cards by
default. Blocking gates require an explicit project-state reason such as unsafe
permissions, missing plan approval, missing verification evidence, or policy
violation. Non-blocking review cards MUST be sparse, deduplicated, and cooldown
aware.

Rationale: The product should make supervision easier to practice, not make
normal coding approvals feel like homework.

### VI. Typed Seams And Testable Determinism
DIVE v2 MUST prefer typed domain models, explicit contracts, and small adapter
seams over broad implicit coupling. Workflow state, evidence, supervisor
decisions, review-card contracts, EventLog records, Pi runtime messages, and
export formats MUST be represented as typed domain concepts.

Deterministic trigger logic MUST be covered by unit tests. LLM judgment may
critique supplied artifacts, but lifecycle event detection, evidence collection,
deduplication, cooldown, logging, and drop conditions MUST be deterministic and
testable. Broad rewrites are allowed only when the spec identifies the contract
being preserved, removed, or replaced.

Rationale: v2 should be clean because its boundaries are explicit, not merely
because it starts in an empty directory.

## DIVE v2 Product Boundaries

DIVE v2 is defined by these mandatory boundaries:

- The primary workflow is Decompose -> Instruct -> Execute -> Verify -> Extend.
- The existing DIVE UI/UX is the behavioral baseline, but internal contracts may
  be rewritten when a spec explicitly defines the replacement.
- Pi runtime is required and bundled for classroom builds; Node must not be a
  student-installed prerequisite.
- Legacy runtime fallback, static provocation fallback, keyword-generated
  review cards, standalone card decks, badges, scores, fake reflection gates,
  and generic warning banners are out of scope.
- The v2 supervision architecture is organized around ProjectWorkflow,
  EvidenceModel, SupervisorAgent, ReviewCardSystem, and EventLogExport.
- SupervisorAgent decisions are invoked by deterministic workflow events and
  must be dropped when evidence is missing, malformed, duplicated, or not a
  question.

## Development Workflow And Quality Gates

All v2 implementation work MUST follow the spec-kit flow unless the user
explicitly approves an emergency exception:

1. Constitution compliance is checked before specification, planning, tasks,
   and implementation.
2. Specifications define what and why, including user scenarios, non-goals,
   evidence expectations, and measurable success criteria.
3. Plans define runtime, architecture, data contracts, and test strategy.
4. Tasks are split into independently testable vertical slices and include
   deterministic tests for workflow gates, evidence, runtime boundaries, and
   EventLog/export behavior.
5. Implementation cannot begin while unresolved NEEDS CLARIFICATION markers
   affect product scope, privacy, safety, runtime, or user experience.

Required checks for v2 features:

- Pi runtime boundary tests for any execution-path change.
- EventLog/export tests for any supervision, review-card, verification, or
  approval change.
- Unit tests for deterministic triggers, drop rules, cooldown, deduplication,
  and typed parsing.
- UI checks for contextual placement when adding or moving supervision surfaces.
- Documentation updates when a feature changes product scope, runtime behavior,
  or research-export semantics.

## Governance

This constitution supersedes conflicting implementation habits, prior draft
plans, and legacy runtime assumptions for DIVE v2. Historical ADRs remain
valuable context, but a v2 spec may intentionally replace a v1 decision when it
states the old decision, the new decision, and the migration consequence.

Amendments require an explicit spec or ADR update, a short rationale, affected
template review, and user approval. Versioning follows semantic versioning:
MAJOR for incompatible governance or principle redefinitions, MINOR for new
principles or materially expanded guidance, and PATCH for clarifications that do
not change obligations.

Every plan and review MUST include a Constitution Check. Any violation must be
documented with why it is necessary and what simpler compliant alternative was
rejected. Unjustified violations block implementation.

**Version**: 1.1.0 | **Ratified**: 2026-06-14 | **Last Amended**: 2026-07-02
