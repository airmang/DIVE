# DIVE v2 Foundation Decision Log

**Date**: 2026-06-14
**Status**: Draft for user review
**Spec**: `specs/001-dive-v2-foundation/spec.md`

## DEC-001: Spec First, Repo Shape Later

- **Decision**: Confirm DIVE v2 product scope, non-goals, runtime assumptions,
  supervision contracts, and export expectations before choosing same-repo
  branch, monorepo package, or separate repository.
- **Rationale**: A clean repository does not guarantee a clean product. The v2
  spec must define the boundaries first.
- **Implication**: No implementation work starts until the v2 foundation spec is
  reviewed and remaining scope questions are resolved.

## DEC-002: Pi Runtime Only

- **Decision**: DIVE v2 requires Pi runtime as the only agent execution
  runtime.
- **Rationale**: Runtime ambiguity caused legacy compatibility decisions to
  accumulate. V2 should have one supervision boundary to test and audit.
- **Implication**: Unsupported runtime or provider states are surfaced as setup
  or capability states rather than silently routed elsewhere.

## DEC-003: No Legacy Or Static Fallback

- **Decision**: DIVE v2 excludes legacy Rust AgentLoop fallback, environment
  runtime fallback, static provocation fallback, and keyword-generated review
  cards.
- **Rationale**: Fallback behavior hides product decisions and weakens the
  supervision evidence model.
- **Implication**: If the supervisor cannot produce an evidence-backed question,
  the correct behavior is silence or an explicit unavailable state, not a
  generic fallback card.

## DEC-004: Supervision Is A Separate Capability, Not The Workflow

- **Decision**: ProjectWorkflow remains the main product flow; supervision
  appears through SupervisorAgent, EvidenceModel, ReviewCardSystem, and
  EventLogExport.
- **Rationale**: Review cards should help users supervise real work, not become
  the work itself.
- **Implication**: Any supervision feature must point to a concrete artifact and
  log exposure and response locally.

## DEC-005: Existing UI/UX Is The Behavioral Baseline

- **Decision**: V2 preserves the visible DIVE experience where it still serves
  the product, but old internal contracts may be replaced by explicit typed v2
  contracts.
- **Rationale**: Copying old coupling would reproduce v1 complexity. Preserving
  visible continuity is more important than preserving old seams.
- **Implication**: Later specs must state which v1 surfaces are kept, removed,
  or rewritten.

## DEC-006: Provocation Cards Use A Separate Pi SupervisorAgent

- **Decision**: Provocation/review cards are driven by a dedicated Pi
  SupervisorAgent that returns `SupervisorDecision`, not final UI cards.
- **Rationale**: The coding agent's goal is to solve the task, while the
  supervisor's goal is to critique evidence. Mixing them would blur auditability
  and increase prompt-injection risk.
- **Implication**: SupervisorAgent runs as a no-tools, no-resource-discovery,
  one-shot evaluator. DIVE validates evidence refs, action allowlists,
  question shape, deduplication, cooldown, and EventLog/export before rendering
  any card.
