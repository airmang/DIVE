# Tasks: Self-Improvement Loops (015)

Dependency-ordered; each stage is an independently verifiable slice. `[P]` =
parallelizable with the other `[P]` stage of the same wave. Every stage ends
with the full CI command set (plan.md §Technical Context) + adversarial review.

## Wave 1

### S-076 — Signal instrumentation [P]

- [x] T001 `dive/prompt_version.rs`: `PromptVersion` type, fingerprint hash, render; unit tests.
- [x] T002 Supervisor prompt semver + fingerprint + pin test; `prompt_version` in `SupervisorEvaluationLog`.
- [x] T003 Coach prompt semver + pin test; `promptVersion` in coach requested/evaluated payloads.
- [x] T004 PRD interview prompt semver + pin test; new `prd_interview.turn_evaluated` event per turn.
- [x] T005 `supervision-policy.json` + Rust `SupervisionPolicy` (include_str + OnceLock) + TS import; move thresholds; parity test; FE sends `policyVersion`; Rust logs it.
- [x] T006 `question` in `SupervisorDecisionSummary` and `card_shown` payload; sanitizer check test.
- [x] T007 `ProvocationCardHost`: `responseLatencyMs`, `provocation.card_unanswered` (superseded/unmounted/page_hidden), one terminal event per exposure; vitest.
- [x] T008 Session-id resolution in `provocation_log_event` + `projectId` from all host parents; export test for complete `provocation.*` coverage.
- [x] T009 Migration v20 `Session.origin` + creation rule + export `session_meta.origin`; migration + export tests.
- [x] T010 Docs: event catalog / export semantics note (Constitution doc-update gate).

### S-077 — QA ledger [P]

- [x] T020 `docs/qa/ledger/` layout + README; `scripts/qa-ledger/schema.mjs`, `load.mjs`, `validate.mjs`, `schema.md`.
- [x] T021 Vitest include `scripts/**/*.test.mjs`; validator unit tests + real-ledger test; `qa:ledger:validate` script.
- [x] T022 Scenario records from archived catalog + e2e journeys with area globs.
- [x] T023 Re-check the 2026-07-22 survivors (read-only parallel agents, evidence-cited) and seed defects per D-015-04.

## Wave 2

### S-078 — Replay corpus (after S-076)

- [x] T030 Migration v21 `SupervisionReplay` + DAO + retention on insert; tests.
- [x] T031 Capture at supervisor/coach/PRD evaluation sites; bounded raw output.
- [x] T032 `replayCapture` preference + clear IPC + Settings control; tests.
- [x] T033 Export: default exclusion test; `include_replay` path with anonymizer test.

### S-079 — Eval harness (after S-078)

- [x] T040 Fixture format + ≥30 synthetic fixtures (dev/holdout; all events × locales × modes).
- [x] T041 `eval::supervisor` module: load, validate recorded outputs through the real path, metrics, JSON report.
- [x] T042 `tests/eval_supervisor_recorded.rs` (CI) coverage + recording presence assertions.
- [x] T043 Live `#[ignore]` runner with call cap; records + baseline report.
- [x] T044 `scripts/eval-report.mjs` Markdown + `--compare`; advisory judge section; tests.

### S-080 — Guard-required closure (after S-077) [P with S-078]

- [x] T050 `guards.mjs` resolvers (vitest list, cargo list/ignored, eval fixture, live-scenario run); tests with stubbed runners.
- [x] T051 `verify:qa-ledger`; vitest-side CI check; attach to `verify:v4` track.
- [x] T052 Import the re-check's fixed findings whose guards resolve through their runner as `fixed` (amended D-015-04; seed file `docs/qa/ledger/seed/2026-09-29-post-cleanup-recheck.json`).

## Wave 3

### S-081 — Field aggregation (after S-076)

- [x] T060 `analyze-cards.mjs` grouping + rates + latency + drop reasons + origin filter; tests on synthetic exports.
- [x] T061 `--exemplars` output; docs on human-reviewed promotion.

### S-082 — Run records + queue (after S-077, S-080)

- [x] T070 Run record validator; `qa:queue` selection rules; work-order output; tests.
- [x] T071 Area-table fitness (S-077 review): LLM scenarios also carry `pi-sidecar`; narrow the 50 journeys' blanket areas (e.g. STATIC-01 `terminal` false positive); a test lists tracked source files in no area (unmapped change ⇒ select all + warn); read diffs with `git -c core.quotePath=false diff --name-only` (non-ASCII paths); forbid in-segment `**`.

## Wave 4

### S-083 — Improvement cycle (after S-079, S-081)

- [x] T080 Runbook + work-order template + `eval-gate.mjs`; tests.
- [x] T081 Execute one cycle; PR with before/after report. (cycle run + gate PASS; PR push awaits owner)

### S-084 — Triage bridge (after S-080, S-082, S-079)

- [x] T090 `triage.mjs` clustering + stub/payload drafts; eval-gate → `source: eval` defects; tests.
- [ ] T091 Execute one B cycle; record artifacts. (blocked: macOS Screen Recording permission for computer-use)
