# Quickstart: Sarkar Provocation Expansion

## Prerequisites

- Current implementation branch: `codex/s-022-sarkar-provocation-expansion`
- Feature spec: `specs/006-sarkar-provocation-expansion/spec.md`
- Implementation plan: `specs/006-sarkar-provocation-expansion/plan.md`
- Pi supervisor runtime available for shown-card scenarios

## Validation Commands

Run focused frontend tests:

```bash
cd dive
pnpm test:unit -- PlanDraftApprovalScreen StepDetailSlideIn provocation adapters logging
```

Run focused Rust tests:

```bash
cd dive/src-tauri
cargo test provocation_agent
cargo test supervisor
cargo test event_log
cargo test export
```

Run full checks before handoff:

```bash
cd dive
pnpm typecheck
pnpm test:unit
cd src-tauri
cargo test
```

## Scenario 1: Plan Draft Review Card

1. Start a project with a PRD and generate a plan draft.
2. Use a draft where at least one step lacks feasible verification or criterion
   linkage.
3. Open the plan approval screen.
4. Expected:
   - A `plan_drafted` supervisor evaluation is logged.
   - At most one card appears near the plan draft approval artifact.
   - The card cites only DIVE-provided plan/criteria/verification refs.
   - A well-scoped draft with covered criteria shows no card.
   - Supervisor unavailable/invalid output shows no fallback card.

## Scenario 2: Diff-Ready Review Card

1. Complete a step with changed files.
2. Include at least one changed file outside expected files or a high-risk area.
3. Open the step review/diff surface.
4. Expected:
   - A `diff_ready` supervisor evaluation is logged.
   - At most one card appears near changed-work review.
   - The card asks whether the changed files belong to the current goal.
   - Expected files only, or no concrete scope evidence, stays silent.

## Scenario 3: Retry-Loop Review Card

1. Run verification or a terminal command for an active step.
2. Produce the same normalized failure at least twice without a successful
   verification in between.
3. Open the failure/recovery surface.
4. Expected:
   - A `retry_loop` supervisor evaluation is logged after the second matching
     failure, not after the first.
   - At most one card appears near the failure/recovery artifact.
   - A recovery, rollback, successful verification, or materially new failure
     resets or changes the evidence identity.

## Scenario 4: EventLog And Export

1. Create one shown `plan_drafted` card, one silent `diff_ready` evaluation, and
   one dropped `retry_loop` decision.
2. Export the session.
3. Expected:
   - Export contains `provocation.supervisor_evaluated` records for shown,
     none, and dropped outcomes.
   - Each record includes event type, artifact ref, bounded evidence refs,
     validation outcome, drop reason when present, card id when shown, and
     supervisor evaluation id.
   - Raw diffs, full terminal bodies, secrets, OAuth tokens, API keys, private
     environment dumps, and student PII are absent.

## Regression Checks

- Existing `verify_entered` final approval card still appears only for
  AI-self-report without concrete evidence.
- Existing `scope_expansion` add-step card still uses SupervisorAgent and still
  has no static fallback.
- Public `generateProvocationCards` remains shipped-safe no-op unless the
  internal dev flag is enabled.
- Expanded cards never render as chat assistant messages.
- Retry-loop cards are step-scoped; terminal-only repeated text without active
  step/session evidence does not produce a shipped card.
- Work Mode does not require long-form reflection for low-risk states.

## Phase 1 Inventory Result (2026-06-16)

- 006 spec branch content was merged into implementation branch
  `codex/s-022-sarkar-provocation-expansion`.
- Public `generateProvocationCards` is still shipped-safe no-op by default and
  only delegates to quarantined rule cards when
  `VITE_DIVE_INTERNAL_PROVOCATION_RULE_CARDS=true`.
- Remaining production call sites before implementation:
  `PlanDraftApprovalScreen.tsx`, `TerminalTab.tsx`, `MessageList.tsx`, and
  `useProvocationCards.ts`. The plan approval surface will switch to
  SupervisorAgent-backed `plan_drafted`; terminal/chat rule-card calls stay
  no-op in shipped builds unless active step/session backend evidence is added.

## Validation Results (2026-06-16)

- `pnpm typecheck` passed.
- `pnpm test:unit` passed: 45 test files, 241 tests.
- `cargo test` passed from `dive/src-tauri`: 465 library tests passed, 7 ignored,
  plus all integration/doc test targets passed.
- Focused validation during implementation also passed for:
  - `pnpm test:unit -- StepDetailSlideIn provocation adapters`
  - `pnpm test:unit -- provocation logging`
  - `cargo test supervisor`
  - `cargo test provocation_agent`
  - `cargo test event_log`
  - `cargo test export`
