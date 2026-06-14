# DIVE Spec Status

**Last updated**: 2026-06-14

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
| `specs/004-prd-decompose-lifecycle/spec.md` | Canonical | Elevates interview to PRD authoring; criterion-linked decomposition; mid-flow step add; living PRD. |
| `specs/004-prd-decompose-lifecycle/decisions.md` | Canonical | Records PRD/decompose lifecycle decisions. |

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
