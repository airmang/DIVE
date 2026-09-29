# Implementation Plan: Self-Improvement Loops (015)

**Branch**: `015-self-improvement-loops` · **Spec**: [spec.md](spec.md) ·
**Decisions**: [decisions.md](decisions.md) · **Stages**: Wily S-076–S-084

## Summary

Loop A makes supervision behavior attributable (versions, question text,
terminal card events, session origin), captures replayable inputs locally,
measures card quality offline, reads field responses back, and defines an
owner-gated improvement cycle. Loop B turns QA into a machine-readable ledger
whose defects close only with runner-resolved guards, records live runs, and
computes re-run queues and triage drafts. Nothing in DIVE adapts at runtime
(D-015-01).

## Technical Context

- Rust (Tauri 2) in `dive/src-tauri`, React 19 + TS in `dive/src`, Node ESM
  scripts in `dive/scripts`. SQLite via `db/migrations.rs`
  (`LATEST_SCHEMA_VERSION` = 19 today).
- No new runtime dependencies (no YAML, no Ajv — D-015-07).
- CI gates (must stay green every stage): `cargo fmt --check`,
  `cargo clippy --features dev-mock --all-targets -D warnings`,
  `cargo clippy -D warnings`, `cargo test --features dev-mock --all-targets`,
  frontend `format:check`, `typecheck`, `lint`, `test:unit`, `verify:v4`.
  Known env-dependent reds are tracked in memory, not fixed here.
- Workflow files are not edited (D-015-08).

## Architecture by Stage

### S-076 — Signal instrumentation (FR-001–FR-006)

1. **Prompt versions** — new `dive/src-tauri/src/dive/prompt_version.rs`:
   `PromptVersion { surface, semver, template_hash }` rendered
   `"<semver>+<8-hex>"`. Each builder module declares
   `const PROMPT_SEMVER: &str` and a `const PROMPT_TEMPLATE_FINGERPRINT` string
   holding its static template parts; the hash is computed from the
   fingerprint. A unit test per surface pins `(semver, hash)`; editing the
   template without bumping semver fails the pin test with a message telling
   the author to bump. Surfaces: SupervisorAgent (`supervisor/prompt.rs`),
   verification coach (`dive/verification_coach.rs:249`), PRD interview
   (`ipc/workspace_plan/prd_interview.rs:361/406`).
   - Supervisor: add `prompt_version`, `policy_version` to
     `SupervisorEvaluationLog` (`decision.rs:305`, `from_validation`).
   - Coach: add `promptVersion` to `log_requested`/`log_evaluated` payloads.
   - PRD: new event `prd_interview.turn_evaluated` per turn (outcome,
     model, promptVersion, parse failure kind) — today a no-patch turn writes no
     EventLog row.
2. **SupervisionPolicy** — single source
   `dive/src/features/provocation/supervision-policy.json`
   (`{ "policyVersion": "1.0.0", "retryLoopMinFailures": 2,
   "broadStepMinExpectedFiles": 4, ... }`), imported by TS
   (`resolveJsonModule`) and embedded in Rust via `include_str!` + serde into a
   typed `SupervisionPolicy` (`OnceLock`). Moves the values listed in the
   S-076 survey (decision.rs retry gate, adapters.ts thresholds/caps,
   `SCOPE_SUPERVISOR_DEBOUNCE_MS`). Output-contract limits (question 140 chars,
   evidence/action caps, 24 KB prompt cap) stay constants — they are schema,
   not policy. Behavior-preserving: existing tests stay green unchanged. The
   FE sends `policyVersion` with each evaluation request; Rust logs it and a
   parity test asserts FE and Rust read the same file.
3. **Question text** — add `question` to `SupervisorDecisionSummary` (shown
   decisions) and to the `provocation.card_shown` payload (`card.prompt`).
   Verify the export sanitizer does not hash the `question` key by name
   (D-015-03); PII/secret detectors still apply.
4. **Terminal card events** — `ProvocationCardHost`: record `shownAt` per card
   exposure; on response add `responseLatencyMs`; on card removal/unmount
   without response emit `provocation.card_unanswered { visibleMs, reason:
   "superseded" | "unmounted" | "page_hidden" }`. Add a `pagehide` listener
   (best-effort for app close). Exactly one terminal event per exposure.
5. **Session id** — Rust `provocation_log_event`: when `session_id` is `None`
   and the payload has a `projectId`, resolve via the existing
   `latest_session_id_for_project` (`plan_lifecycle.rs:456`) precedent; FE
   passes `projectId` from every host parent (TerminalTab, PrdAuthoringBoard
   included). Export test (`tests/export_jsonl.rs`) asserts all
   `provocation.*` events for a session are exported.
6. **Session origin** — migration v20: `Session.origin TEXT NOT NULL DEFAULT
   'classroom' CHECK (origin IN ('classroom','qa','dev'))`. Set at creation:
   env `DIVE_SESSION_ORIGIN` (validated) > `cfg!(debug_assertions)` → `dev` >
   `classroom`. Exported in `session_meta`.

### S-077 — QA ledger (FR-010–FR-012)

- `docs/qa/ledger/{defects,scenarios,runs}/` + `docs/qa/ledger/README.md`.
- `dive/scripts/qa-ledger/` ESM modules: `schema.mjs` (typed validators,
  enums), `load.mjs`, `validate.mjs` (CLI `pnpm qa:ledger:validate`),
  `schema.md`. Vitest include widened to `scripts/**/*.test.mjs`; a test runs
  the validator over the real ledger so CI enforces it via `test:unit`.
- Seed: re-check the 70 survivors of `post-cleanup-review-2026-07-22.md`
  against the current tree (parallel read-only agents, each verdict
  evidence-cited); import per D-015-04. Scenarios: archived
  `docs/archive/qa/scenario-catalog.md` (54) + `docs/qa/e2e-journeys.md` (50)
  with `areas` → path globs.

### S-078 — Replay corpus (FR-020–FR-021)

- Migration v21: `SupervisionReplay(id, evaluation_id UNIQUE, surface, session_id,
  created_at, prompt_version, policy_version, model, context_json,
  raw_output, validation_json)`; raw output bounded (e.g. 16 KB).
- Written from the same sites that log S-076 evaluation events. Retention
  enforced on insert (500 rows / 30 days). Preference `replayCapture`
  (default on) + "clear" IPC used by Settings.
- Export: default excludes; `ExportOptions.include_replay` (research replay
  export) runs `anonymize_value` over context/raw output.

### S-079 — Eval harness (FR-030–FR-034)

- `dive/eval/supervisor/fixtures/{dev,holdout}/*.json`:
  `{ id, context: SupervisorContext, expect: {...}, recorded: { [promptVersion]:
  [rawOutput...] } }`. Synthetic only.
- Rust: `dive_lib::eval::supervisor` module — loads fixtures, runs recorded raw
  outputs through the real parse + validate path, computes metrics, writes
  `target/eval/supervisor-<promptVersion>.json`.
  - Recorded mode = integration test `tests/eval_supervisor_recorded.rs`
    (runs in CI; asserts fixtures parse, every event type covered, and the
    current promptVersion has recordings).
  - Live mode = `#[ignore]` test following `connected_provider_smoke.rs`
    (copied DB + keyring → provider runtime → real Pi supervisor call), call
    cap 2×fixtures, writes new recordings + report.
- Node `scripts/eval-report.mjs`: JSON → Markdown summary, `--compare a b`;
  LLM-judge section only when a judge file is supplied (advisory, D-015-05).

### S-080 — Guard-required closure (FR-040–FR-041)

- `scripts/qa-ledger/guards.mjs`: resolve guards by kind — `vitest` via
  `vitest list --json`, `cargo` via `cargo test --features dev-mock -- --list`
  (+ `--ignored` list to detect ignored guards), `eval-fixture` via fixture ids,
  `live-scenario` via run records newer than the fix commit (`git log`).
- `pnpm verify:qa-ledger` = validate + resolve. CI path: vitest-side check of
  vitest/eval guards; cargo resolution local + release-gate (D-015-08).

### S-081 — Field aggregation (FR-050–FR-051)

- `scripts/analyze-cards.mjs` + tests over synthetic exports; groups by
  non-identifying keys; `--include-origin qa,dev`; `--exemplars` lists
  evaluation ids (hashed ids are per-export — exemplar lookup happens on the
  machine that holds the replay corpus, via an unhashed local export).

### S-082 — Run records + queue (FR-060–FR-061)

- `runs/<date>-<id>.json` validator; `scripts/qa-ledger/queue.mjs`
  (`pnpm qa:queue [--since <ref>]`) → Markdown work order in
  `.harness/work-orders/qa/` (gitignored) using the release-`.app` +
  computer-use recipe.

### S-083 — Improvement cycle (FR-070–FR-072)

- `docs/improvement-cycle.md` runbook + `.specify`-adjacent work-order
  template; gate script `scripts/eval-gate.mjs` (holdout tolerance, hard fails).
- One cycle: take baseline from S-079 live mode, pick the weakest
  deterministic metric, change one thing, bump version, re-run, open PR.

### S-084 — Triage bridge (FR-080–FR-081)

- `scripts/qa-ledger/triage.mjs` → spec-theme stub Markdown + Wily
  `design_stage` payload JSON (drafts in `.harness/`); `eval-gate` failures
  write `source: eval` defects. One recorded B cycle.

## Testing Strategy

Every stage lands with: Rust unit/integration tests for new domain logic and
migrations; EventLog/export tests for any new event or field (Constitution
quality gate); vitest for FE host behavior and Node scripts; full CI command
set green locally before stage completion; an adversarial review pass by a
separate agent (read-only git, per memory) before the stage is closed.

## Risks

- **Policy JSON across trees** — `include_str!` path from `src-tauri` into
  `src/`; if bundling objects, move the file to `dive/shared/` instead.
- **card_unanswered double counting** on remount — exposure key =
  card id + mount instance; tests assert one terminal event per `card_shown`.
- **Live eval cost/flakiness** — capped and manual; CI uses recorded mode only.
- **Seed re-check volume** (70 findings) — parallel read-only agents; any
  finding not confidently re-verified is imported as `open` with a
  `needs-recheck` note rather than dropped.
