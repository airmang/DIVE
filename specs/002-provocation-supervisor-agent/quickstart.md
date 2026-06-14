# Quickstart: Validate Provocation Supervisor Agent

**Spec**: [spec.md](./spec.md)

This guide describes the validation path after implementation tasks are
generated and completed. It is not a manual implementation checklist.

## Prerequisites

- Dependencies installed in `dive/`.
- Pi sidecar dependencies installed or built through the existing sidecar
  scripts.
- A sample DIVE project/session with at least one roadmap step.

Useful setup commands:

```bash
cd dive
pnpm install
pnpm install:sidecar
```

## Static Checks

```bash
cd dive
pnpm typecheck
pnpm test:unit
```

Expected:

- TypeScript compiles.
- Existing provocation/card tests pass after migrated expectations are updated.
- No P1 test expects `standard` or `expert` as canonical supervisor modes.

## Rust Domain And Validator Tests

```bash
cd dive/src-tauri
cargo test supervisor
```

Expected:

- `guided -> guided`, `standard -> work`, `expert -> work`.
- Unknown mode drops/logs `invalid_mode`.
- Missing/unknown evidence refs drop.
- Non-question output drops.
- Unknown action IDs are stripped without dropping an otherwise valid card.
- Duplicate `(artifactRef, concern, evidenceHash)` drops within the session.
- Over-cap focal question drops with `content_too_long`.

## Pi Sidecar Boundary Test

```bash
cd dive/src-tauri
cargo test pi_sidecar_supervisor
```

Expected:

- Supervisor run sends explicit `tools: []`.
- Sidecar `ready.enabled_tools` is `[]`.
- Built-ins/resource discovery are unavailable.
- Runtime unavailable, timeout, malformed JSON, and sidecar error produce no
  card plus logged error/drop outcomes.

## Verify/Final Approval UI Scenarios

Run the app in development:

```bash
cd dive
pnpm tauri:dev
```

Scenario A: AI self-report only

1. Open a sample roadmap step.
2. Simulate or produce an assistant completion claim.
3. Do not run tests, open preview, launch app, review diff, or add manual
   verification evidence.
4. Enter verification/final approval.

Expected:

- One nearby "확인 필요 카드" or "검토 카드" appears.
- The card is not a chat message.
- The card asks one criterion-linked question.
- The card cites DIVE evidence refs.
- The card is non-blocking in Work Mode.

Scenario B: concrete evidence exists

1. Record actual concrete verification evidence.
2. Enter verification/final approval.

Expected:

- No `ai_self_report_only` card appears.
- A `provocation.supervisor_evaluated` log still records the no-card outcome
  when an evaluation occurs.

Scenario C: verification is not feasible

1. Use a step with no preview target, runnable app, or tests.
2. Enter verification/final approval.

Expected:

- `open_preview`, `run_app`, and `run_tests` are not offered.
- A feasible action such as `open_diff` may be offered when available.
- Clicking preview/run app cannot fabricate concrete verification evidence.
- The user has a clearly labeled non-risk proceed path when no concrete
  verification is currently possible.

## Export Validation

Export a session containing:

- One shown supervisor card.
- One dropped malformed/invalid decision.
- One runtime failure or timeout.
- One card user response.

Expected:

- Export includes `provocation.supervisor_evaluated` records for shown,
  dropped, and error outcomes.
- Export separates AI self-report from concrete verification evidence.
- Export includes `contextHash`, `evidenceHash`, `cardId` when shown, and
  `dropReason` when dropped/error.
- Export does not contain raw code, raw diff, raw terminal output, full
  transcripts, secrets, OAuth tokens, API keys, environment dumps, or unmasked
  student PII.

## Stage F Validation Record (2026-06-14)

### Automated Commands

| Command | Result | Notes |
| --- | --- | --- |
| `cd dive/src-tauri && cargo test supervisor` | Failed before filtered tests ran | Cargo compiled integration test crates without the `dev-mock` feature, so existing tests importing `dive_lib::MockProvider` and `AppState::dev_mock()` failed to compile. This is a test harness feature-gating issue, not a supervisor assertion failure. |
| `cd dive/src-tauri && cargo test pi_sidecar_supervisor` | Failed before filtered tests ran | Same default-feature `MockProvider`/`AppState::dev_mock()` integration-test compile failure as above. |
| `cd dive/src-tauri && cargo test --features dev-mock supervisor` | Passed | 37 supervisor/export/event-log/sidecar filtered tests passed; 389 tests filtered out. |
| `cd dive/src-tauri && cargo test --features dev-mock pi_sidecar_supervisor` | Passed | 5 sidecar supervisor boundary tests passed; 421 tests filtered out. |
| `cd dive && pnpm typecheck` | Passed | TypeScript compiled with `tsc --noEmit`. |
| `cd dive && pnpm test:unit` | Passed | 29 test files, 143 tests passed. |

### Verify/Final Approval Scenario Coverage

Live `pnpm tauri:dev` manual clicking was not run in this Stage F pass. The
scenario checks below were validated through the focused Rust/TypeScript test
coverage named here, with the remaining live-app pass still recommended before
release packaging.

| Scenario | Stage F result |
| --- | --- |
| AI completion claim alone is not treated as verified evidence | Passed via `supervisor_concrete_evidence_requires_pass_or_observation_linked_to_criterion`, `StepDetailSlideIn.test.tsx`, and `logging.test.ts`. |
| `verify_entered` is the P1 render point; `ai_claimed_done` records evidence only | Passed via `supervisor_p1_gate_fires_only_for_verify_self_report_without_concrete_evidence` and `StepDetailSlideIn.test.tsx`. |
| A card can render when there is AI self-report and no concrete evidence | Passed via `provocation_agent_evaluate_maps_stage_c_shell_to_shown_response` and `StepDetailSlideIn.test.tsx`. |
| Concrete evidence suppresses the `ai_self_report_only` card | Passed via `provocation_agent_evaluate_returns_none_when_concrete_evidence_exists` and `StepDetailSlideIn.test.tsx`. |
| Infeasible actions do not appear on the card | Passed via `ProvocationCard.test.tsx`, `useProvocationActionResolver` coverage, and Rust feasibility/action filtering tests. |
| Preview/app click-only signals do not become `verified_with_evidence` | Passed via `StepDetailSlideIn.test.tsx`, `logging.test.ts`, and `verificationGrade`/`verificationStatus` tests. |
| `verification_deferred` is distinct from `continue_with_risk` | Passed via `DecisionGate.test.tsx`, `logging.test.ts`, and approval-domain Rust tests. |
| Card exposure/action/dismiss/mark-irrelevant logs include `supervisorEvaluationId` when present | Passed via `logging.test.ts`. |
| Export sanitizer avoids raw code/diff/terminal/secrets/PII in supervisor payloads | Passed via Rust export sanitizer tests under `cargo test --features dev-mock supervisor`. |

### Stage F Compatibility Notes

- `dive/src/features/provocation/rules.ts` is quarantined: public
  `generateProvocationCards` returns no cards unless the internal dev flag
  `VITE_DIVE_INTERNAL_PROVOCATION_RULE_CARDS=true` is set in dev mode.
- `dive/src/features/provocation/index.ts` no longer re-exports `rules.ts` or
  `useProvocationCards`, so shipped/classroom code cannot import legacy rule
  generation through the normal provocation barrel.
- `ToolActivity` no longer renders legacy rule cards or blocks pre-run tool
  approval on old `diff_scope_drift`/`continue_with_risk` card state.
- `SocraticInterviewPanel` no longer imports or renders legacy rule cards.
- `ProvocationCard.tsx` is compatible with `specs/003-supervision-card-ux`: the
  card renders the focal `prompt` question first, hides secondary `message` copy
  in Work Mode, and keeps Guided Mode to one subordinate explanation line plus
  bounded evidence/actions.
