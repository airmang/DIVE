# DIVE Canonical Specs

This directory is the active source of truth for DIVE v2 product and
implementation planning.

## Active Specs

| Spec | Status | Purpose |
| --- | --- | --- |
| [`001-dive-v2-foundation`](001-dive-v2-foundation/spec.md) | Active foundation | Defines DIVE v2 scope, non-goals, runtime direction, evidence rules, and repo strategy. |
| [`002-provocation-supervisor-agent`](002-provocation-supervisor-agent/spec.md) | Active draft | Defines the dedicated Pi SupervisorAgent that evaluates project evidence and produces review-card decisions. |
| [`003-supervision-card-ux`](003-supervision-card-ux/spec.md) | Active presentation spec | Defines supervision card presentation and information architecture (focal criterion, review-vs-permission distinction, density reduction); presentation only, no flow-logic change. Current status is clarified in its decision log and `docs/spec-status.md`. |
| [`004-prd-decompose-lifecycle`](004-prd-decompose-lifecycle/spec.md) | Implemented with reserved follow-up scope | Elevates onboarding/interview into a dedicated PRD Authoring Board with validated turn-by-turn PRD patches and a concise completed PRD read view; criterion-linked, challengeable decomposition; mid-flow `add_step` in a dedicated area; PRD as a living, versioned artifact. `change_step` and `retire_step` remain future/contract-reserved until a visible path is separately specified and implemented. |
| [`005-v2-spec-conformance-gaps`](005-v2-spec-conformance-gaps/spec.md) | Implemented conformance cleanup | Closes v2 conformance gaps for user-visible legacy runtime fallback removal, add-step scope cards through SupervisorAgent, rationale challenge offers, and truthful spec-status cleanup. |
| [`006-sarkar-provocation-expansion`](006-sarkar-provocation-expansion/spec.md) | Implemented | Expands Sarkar-style SupervisorAgent review-card coverage to plan draft approval, diff-ready review, and retry-loop review while preserving evidence, locality, and no static fallback. |

## Authority Rules

- `.specify/memory/constitution.md` governs all specs.
- Active feature specs under `specs/*/spec.md` govern product behavior.
- Active decisions under `specs/*/decisions.md` govern tradeoffs for that feature.
- Generated `plan.md` and `tasks.md` files are authoritative only inside their
  matching feature directory.
- `docs/superpowers/specs/` and `docs/superpowers/plans/` are historical unless
  an active spec explicitly incorporates them.

## Current Product Decisions

- The current repository remains the working home for v2 consolidation.
- Existing DIVE UI/UX is the behavioral baseline unless an active spec changes it.
- DIVE v2 shipped product has no user-visible legacy runtime fallback.
- Migration work may temporarily keep v1 code until Pi-only execution and
  supervision boundaries are proven.
- Provocation/review cards are governed by a dedicated Pi SupervisorAgent that
  returns `SupervisorDecision`; DIVE validates and maps accepted decisions into
  cards.
- Current implementation alignment for provocation is tracked in
  `specs/002-provocation-supervisor-agent/implementation-gap.md`.
- Supervision card presentation/IA (lean review card, criterion as focal point,
  review-vs-permission visual distinction) is governed by
  `specs/003-supervision-card-ux/spec.md`; supervision flow logic is unchanged.
- Onboarding routes to a dedicated PRD Authoring Board before plan/session work,
  interview turns update the live PRD draft through validated patches,
  saved PRDs use a separate concise read view, decomposition is criterion-linked
  and challengeable, and steps are addable mid-flow in a dedicated area, governed by
  `specs/004-prd-decompose-lifecycle/spec.md`.
- The 004 implementation plan and design contracts are governed by
  `specs/004-prd-decompose-lifecycle/plan.md`, `data-model.md`, `contracts/`,
  `research.md`, `quickstart.md`, and `tasks.md`.
- Remaining v2 conformance cleanup is governed by
  `specs/005-v2-spec-conformance-gaps/spec.md`: legacy runtime fallback has been
  removed from user-visible v2 work, add-step scope-expansion cards use the
  dedicated SupervisorAgent path, rationale challenges offer a non-blocking
  plan-adjustment next action, and future/reserved mutation behavior must not be
  documented as shipped.
- The 005 implementation plan and design contracts are governed by
  `specs/005-v2-spec-conformance-gaps/plan.md`, `data-model.md`, `contracts/`,
  `research.md`, `quickstart.md`, and `tasks.md`.
- Expanded Sarkar-style review-card coverage is governed by
  `specs/006-sarkar-provocation-expansion/spec.md`: `plan_drafted`,
  `diff_ready`, and `retry_loop` are implemented SupervisorAgent events; cards
  remain evidence-grounded, artifact-adjacent, non-blocking, sparse,
  logged/exportable, and have no static fallback.
- The 006 implementation plan and design contracts are governed by
  `specs/006-sarkar-provocation-expansion/plan.md`, `research.md`,
  `data-model.md`, `contracts/`, `quickstart.md`, and `tasks.md`.
- `change_step` and `retire_step` are contract-reserved mutation concepts only.
  The shipped visible plan-mutation path from 004/005 is `add_step`; any visible
  change/retire flow needs a later spec, implementation, validation, and status
  update.

## Adding Or Changing Specs

1. Update or create the relevant `specs/<feature>/spec.md`.
2. Add decision records in that feature's `decisions.md` when a product or
   architecture tradeoff is resolved.
3. Keep `docs/spec-status.md` aligned when older documents are superseded,
   archived, or promoted into canonical specs.
4. Do not implement from historical documents directly.
