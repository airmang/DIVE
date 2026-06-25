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
| P6 | Router prompt emission of clarify/remove/supersede — `build_system_prompt` teaches the three verbs (output formats, selection criteria, `target_step_id` guardrail). Still propose-only; UI deferred to P8. | done (PR #40) |
| P7 | First-class Duplicate outcome — route_chat's AddStep arm returns a typed `RouteDecision::Duplicate { existing, draft, reason }` (server-side `find_duplicate_step`, **not** a model verb) instead of silently downgrading to chat. Backend-first; UI deferred to P8b. | done (PR #41) |
| **P8a** | **`multi_step` router outcome** — `ROUTE multi_step {JSON}` grammar (one single-line JSON object parsed by serde; flat `field_*` helpers can't hold a per-step batch), `PlanRouterDecision::MultiStep` + wire `RouteDecision::MultiStep { drafts, reason }`, route→wire mapping building `Vec<MultiStepDraftInput>` with placeholder ids (apply IPC owns allocation), prompt emission. Backend-first, propose-only; UI deferred to P8b. | **active** |
| P8b | Plan-diff consumer UI — confirm modal surfacing clarify/remove/supersede/duplicate/multi_step proposals and triggering the apply IPCs (`appendStep`/`appendSteps`/remove/supersede); includes the `StepDraftInput.rationale` Option↔string TS fix before rendering `draft.rationale`. | planned |

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
- P7 `Duplicate` is detected **server-side** in route_chat's AddStep arm via
  `find_duplicate_step` (normalized title/instruction/summary equality) — it is
  **not** a router verb; the LLM never self-reports duplicates and the prompt
  stays unchanged. The apply IPCs (`append_step`/`append_steps`) keep their own
  hard-`Err` duplicate guard as defense-in-depth. Two consumers narrow on
  `add_step` and read `decision.reason` in the fall-through (`handleBeforeChatSend`
  in `useProductShellController.ts`, `handleDraftRequest` in
  `PlanDashboardPanel.tsx`); P8b must surface the duplicate proposal in both.
- P8a `multi_step` uses a **JSON-rest** grammar (`ROUTE multi_step {JSON}`, one
  single-line object parsed by `serde_json`) because the flat `field_string`/
  `field_array` helpers each read only the first occurrence of a key and
  `field_array`'s `\[[^\]]*\]` regex can't hold a nested array — so a repeated
  per-step batch is structurally impossible in the flat grammar. Router-level
  validation covers empty-steps / out-of-range / self-dep only; **cycle and
  `MAX_PLAN_STEPS` checks are intentionally deferred** to `append_steps` at apply
  time (a cyclic/oversized batch still parses as a valid propose-only proposal).
  The route→wire mapping builds drafts with placeholder `step_id`/`position` via
  `router_draft_to_input_unallocated` so the apply IPC owns id allocation.

## Validation loop

Per 009: spec/plan → implement → local CI gates (rust fmt + clippy
`--all-targets --features dev-mock -D warnings` + full test; frontend
format:check + typecheck + lint + unit) → rebuild → live re-run the relevant
journeys in `ko` and `en` → verify.
