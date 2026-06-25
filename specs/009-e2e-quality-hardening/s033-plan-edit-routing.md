# S-033 — Plan-edit routing (009 theme 5) — phase ledger

**Wily Stage**: S-033 (`STG-af8ce7d7732e`, project `dive-2`).
**Spec**: [`spec.md`](spec.md) theme 5 — plan editing is add-only; no clarify /
remove / genuine multi-step routing, so multi-step asks get crammed into one
oversized step or dropped to chat.

**Acceptance** (from the Stage):
1. The plan router supports clarify, remove, and multi-step edits (not add-only).
2. A genuinely multi-step ask fans into a correct dependency-ordered DAG instead
   of being crammed into one step or dropped to chat.

## Architecture

The router is backend-first and **propose-only**: the LLM emits one `ROUTE …`
line → parsed into a `PlanRouterDecision` → mapped to a wire `RouteDecision`
(resolving `target_step_id` against the live plan; unknown/inactive degrades to
`Skip`) → the UI surfaces the proposal for confirmation → an apply IPC mutates
the plan inside one transaction, recording the mutation + an EventLog event.

- Router prompt/parser: `dive/src-tauri/src/dive/plan_router.rs`
- Route→wire mapping + apply IPCs: `dive/src-tauri/src/ipc/workspace_plan.rs`
- TS wire + hooks: `dive/src/features/planning/usePlanRouter.ts`
- UI consumer: `dive/src/components/product/useProductShellController.ts`
  (`handleBeforeChatSend`) + `PlanRouteConfirmModal.tsx`

## Phase ledger (reconstructed from commit history; this stage's phase plan was
not previously persisted to a doc)

| Phase | Scope | Status |
| --- | --- | --- |
| P1 | Step soft-delete schema + migration v13 | done (PR #35) |
| P2 | Router/wire enum foundation for clarify/remove/supersede (types end-to-end + route→wire mapping; no prompt change, no apply) | done (PR #36) |
| P3 | Activate retire_step — remove-step apply IPC + `plan_step_retired` event/export | done (PR #37) |
| P4 | Supersede-step apply IPC + `plan_step_changed` activation | done (PR #38) |
| P5 | Multi-step fan-out — `workspace_plan_append_steps` batch IPC + DAG topo-sort | done (PR #39) |
| **P6** | **Router prompt emission of clarify/remove/supersede** — teach `build_system_prompt` the three verbs (output formats, selection criteria, `target_step_id` guardrail) so the model actually emits them in production. Still propose-only; UI deferred to P8. | **active** |
| P7 | Duplicate-add handling beyond the existing `find_duplicate_step` add-path guard (explicit duplicate outcome if warranted) | planned |
| P8 | `multi_step` router emission + plan-diff consumer UI — confirm modal surfacing clarify/remove/supersede/multi_step proposals and triggering the apply IPCs | planned |

### Notes

- After P5 the backend apply chain for all single-target mutating verbs is
  complete and tested; P6 only unlocks **emission** (the system prompt taught
  only `add_step`/`chat` before this phase).
- P6 is non-regressive without P8: `handleBeforeChatSend` returns `true`
  (normal chat send) for any non-`add_step` decision, so emitted
  clarify/remove/supersede fall through to chat until P8 wires the UI.
- `multi_step` emission is intentionally bundled with the UI in P8 (per the P5
  commit) — the parser/`PlanRouterDecision`/wire do not yet carry `multi_step`.
- The router context exposes acceptance criteria as plain strings (no ids), so
  `clarify.suggested_criterion_ids` is best-effort (`[]` when unidentifiable);
  the criterion-linked *question* is the user-facing guarantee.

## Validation loop

Per 009: spec/plan → implement → local CI gates (rust fmt + clippy
`--all-targets --features dev-mock -D warnings` + full test; frontend
format:check + typecheck + lint + unit) → rebuild → live re-run the relevant
journeys in `ko` and `en` → verify.
