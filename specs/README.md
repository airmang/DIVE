# DIVE Canonical Specs

This directory is the active source of truth for DIVE v2 product and
implementation planning.

## Active Specs

| Spec | Status | Purpose |
| --- | --- | --- |
| [`001-dive-v2-foundation`](001-dive-v2-foundation/spec.md) | Active foundation | Defines DIVE v2 scope, non-goals, runtime direction, evidence rules, and repo strategy. |
| [`002-provocation-supervisor-agent`](002-provocation-supervisor-agent/spec.md) | Active draft | Defines the dedicated Pi SupervisorAgent that evaluates project evidence and produces review-card decisions. |
| [`003-supervision-card-ux`](003-supervision-card-ux/spec.md) | Active draft | Defines supervision card presentation and information architecture (focal criterion, review-vs-permission distinction, density reduction); presentation only, no flow-logic change. |
| [`004-prd-decompose-lifecycle`](004-prd-decompose-lifecycle/spec.md) | Active draft | Elevates the interview into PRD authoring; criterion-linked, challengeable decomposition; mid-flow step add in a dedicated area; PRD as a living, versioned artifact. |

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
- The interview is elevated to PRD authoring, decomposition is criterion-linked
  and challengeable, and steps are addable mid-flow in a dedicated area, governed
  by `specs/004-prd-decompose-lifecycle/spec.md`.

## Adding Or Changing Specs

1. Update or create the relevant `specs/<feature>/spec.md`.
2. Add decision records in that feature's `decisions.md` when a product or
   architecture tradeoff is resolved.
3. Keep `docs/spec-status.md` aligned when older documents are superseded,
   archived, or promoted into canonical specs.
4. Do not implement from historical documents directly.
