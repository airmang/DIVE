# Feature Specification: Self-Improvement Loops (Round 6)

**Feature Branch**: `015-self-improvement-loops`

**Created**: 2026-09-29

**Status**: Approved (owner, 2026-09-29 — scope "둘 다": product supervision
loop A + development QA loop B; OD-1–OD-5 resolved to the recommended
defaults, see `decisions.md` D-015-02–D-015-06). Staged via Wily S-076–S-084.

**Input**: Owner request 2026-09-29 ("자기 개선 루프 설계 — 둘 다. 하자"), after
an implementation survey of the current tree (this spec's §Current State is that
survey's result; every claim cites the code it was read from).

## Context And Why

DIVE collects a lot and learns nothing back. Both halves of a loop exist, the
return path does not:

- **Product (loop A)** — review-card responses (`provocation.card_shown`,
  `action_clicked`, `dismissed`, `marked_irrelevant`, `continued_with_risk`)
  and per-attempt `provocation.supervisor_evaluated` records (model id,
  latency, usage, validation outcome, 17 drop reasons) are logged local-first
  and exported. Nothing reads them back, nothing measures card quality, and a
  prompt change is invisible in the logs because no prompt version is recorded.
- **Development (loop B)** — seven-plus QA reports under `docs/qa/` drove every
  round since 009, but each is a one-off Markdown file with its own ID scheme.
  The only lifecycle defect register (`defect-log.md`) was deleted in the
  2026-07-03 cleanup; findings reach specs/Wily Stages by hand; the
  `verify:*` guards are mostly source-grep checks that the 2026-07-22 review
  caught passing tautologically.

The goal of 015 is to close both loops **so that every change to supervision
behavior or product quality is proposed from evidence, measured before merge,
and traceable afterwards** — without DIVE changing itself behind the student's
or the researcher's back.

## Core Design Decision — offline, human-gated, versioned (D-015-01)

DIVE does **not** adapt its behavior at runtime from user responses. There is
no per-student learner model, no automatic card suppression from
`marked_irrelevant` history, no self-editing prompt. Improvement happens in an
offline cycle:

```
 field use / QA runs ──► EventLog + local replay corpus ──► export
        ▲                                                     │
        │                                        aggregate + eval report
  release (new promptVersion /                                │
  policyVersion in every log)                    candidate change (branch)
        ▲                                                     │
        └──── owner-approved PR ◄── before/after eval gate ◄──┘
```

Why this, and not runtime adaptation:

1. **Constitution IV (research ledger)** — later analysis is valid only if
   interventions can be reconstructed. A supervisor that silently drifts per
   user makes exposures incomparable. Versioned releases keep every card
   attributable to one fixed prompt + policy.
2. **Constitution VI (determinism)** — drop, dedup, and cooldown rules must be
   deterministic and unit-tested. Tuning moves them between *versions*, never
   between *sessions*.
3. **Constitution V + the risk case** — a student who marks risk cards
   irrelevant is exactly the automation-bias pattern DIVE exists to surface;
   learning to show them fewer cards would optimize against the product.
4. **AGENTS.md claim discipline** — eval metrics are proxies for *card
   quality*, never evidence of improved student supervision skill. Reports
   must say so.

Runtime adaptation (learner model, per-student pacing) remains a possible
future spec with its own constitution ADR; it is out of scope here.

## Current State (survey, 2026-09-29)

Paths relative to `dive/`.

| Area | Exists | Missing |
| --- | --- | --- |
| Card response events | 5 types, `src/features/provocation/logging.ts:31-36`; payload has `supervisorEvaluationId`, hashes, reason text | "unanswered" (shown, never acted on); response latency; question text (`card.prompt` never logged) |
| Supervisor evaluation log | `SupervisorEvaluationLog` (`src-tauri/src/dive/supervisor/decision.rs:303`) — model, latency, usage, outcome, drop reason | prompt version (none anywhere in tree); raw prompt/output (validated then discarded, `ipc/provocation_agent.rs:364`); `user_response` always `None` (`decision.rs:360`) |
| Coach / PRD interview | outcome + reason-code events (`ipc/verification_coach.rs`, `ipc/workspace_plan/prd_interview.rs`) | prompt version; `verification_observation.cleared` defined but never emitted |
| Export | anonymized JSONL, fresh salt per export (`src-tauri/src/export/mod.rs`) | events filtered `WHERE session_id = ?` (`mod.rs:465`) while card events may carry `sessionId: null` (`logging.ts:436`) → possible silent loss |
| Read-back | `scripts/analyze-supervision.mjs` (dissent / over-trust / steer) | anything reading `provocation.*` or supervisor events |
| Tunable policy | env knobs for attempts/timeout | trigger thresholds hardcoded (`failure_count >= 2`, `expectedFileCount >= 4`, `adapters.ts`); `Cooldown` drop reason never produced; dedup in-memory only |
| Eval harness | 51 unit tests with hand-written decision JSON (`supervisor/tests.rs`) | golden fixtures, replay, card-quality metrics, before/after comparison |
| QA ledger (B) | Markdown reports, 50 journeys (`docs/qa/e2e-journeys.md`), archived 54-row scenario catalog | machine-readable defects/scenarios; lifecycle; guard linkage; run records; re-run queue |

## Non-Goals

- No runtime self-adaptation, learner model, or per-user suppression (D-015-01).
- No cloud telemetry. Data leaves a machine only through the existing explicit
  export; the replay corpus is local and excluded from default export.
- No fine-tuning or model training.
- No auto-merge: agent-proposed changes always land via owner-approved PR.
- No new card types, card UX changes, or new blocking gates.
- No claim that DIVE improves students' supervision skill (proxy metrics only).
- No bulk migration of every historical QA finding (see OD-3).

## Requirements *(themes → Stages, in execution order)*

### Wave 1 — Truthful signals (foundation for both loops)

#### Theme A1 — 감독 신호 계측 정비 → Stage **S-076**

- **FR-001** Every LLM-backed supervision surface (SupervisorAgent, verification
  coach, PRD interview) records a `promptVersion` = `<semver const>+<short hash
  of the template source>` in its evaluation event. A unit test fails when the
  template text changes without the semver const changing.
- **FR-002** Introduce a typed `SupervisionPolicy` (compile-time constants,
  versioned `policyVersion`) holding every deterministic trigger threshold now
  scattered in `decision.rs` and `adapters.ts`. Behavior-preserving; logged with
  each evaluation.
- **FR-003** Log the generated question text on `provocation.supervisor_evaluated`
  (shown decisions) and `provocation.card_shown`. Export policy per OD-2.
- **FR-004** Emit `provocation.card_unanswered` when a shown card leaves view
  without a response (superseded, step change, session end/app close
  best-effort), with `visibleMs`. Add `responseLatencyMs` to response events.
- **FR-005** Close the export gap: card events always carry the active session
  id, and an export test proves every `provocation.*` event of a session is in
  that session's export.
- **FR-006** Record session `origin` (`classroom` | `qa` | `dev`) so QA/dev
  runs never contaminate research aggregates. Default `classroom` in release
  builds, `dev` under `dev-mock`; QA harness sets `qa`.

#### Theme B1 — 기계판독 QA 원장 → Stage **S-077**

- **FR-010** `docs/qa/ledger/defects/DEF-NNNN.json` (one file per defect —
  merge-friendly for parallel agents; JSON, not YAML — D-015-07) with a typed
  schema: id, title, source
  (report + finding id | eval run | live run), severity P0–P2, area,
  status (`open` → `fixing` → `fixed` → `verified` | `wontfix` | `duplicate`),
  spec/stage link, repro, `guard` (kind: `vitest` | `cargo` | `live-scenario`
  | `eval-fixture`, ref), `verified` (commit, build version, date, evidence
  path + sha256).
- **FR-011** `docs/qa/ledger/scenarios/*.json` restored from the archived
  scenario catalog + `e2e-journeys.md`, with area tags → path globs.
- **FR-012** Seed per OD-3. Old reports stay as history; the ledger is
  authoritative going forward.

### Wave 2 — Measurement

#### Theme A2 — 로컬 재생 코퍼스 → Stage **S-078**

- **FR-020** Local SQLite `SupervisorReplayRecord`: the exact `SupervisorContext`
  JSON sent (already ≤24 KB and deterministic → prompt is reproducible), prompt
  + policy version, model id, raw model output (bounded), validation result,
  evaluation id. Same for coach and PRD interview turns.
- **FR-021** Retention cap (count + age), user-clearable from Settings;
  capture default per OD-1. Never included in default export; a separate
  explicit "research replay export" runs the existing anonymizer.

#### Theme A3 — 오프라인 평가 하네스 → Stage **S-079**

- **FR-030** `dive/eval/supervisor/fixtures/` — synthetic, repo-committed golden
  set (no student data), ≥30 fixtures covering every `SupervisorEvent`, both
  locales and both modes. Each = `SupervisorContext` + expectations
  (should-provoke, allowed concerns, required evidence refs, locale).
  Split `dev/` and `holdout/`.
- **FR-031** Runner with two modes: **recorded** (validates stored model
  outputs through the real validation path; offline; runs in CI) and **live**
  (calls the configured provider; local-only, manual, cost-bounded per OD-5).
- **FR-032** Deterministic metrics per (promptVersion, policyVersion, model):
  outcome distribution, drop-reason histogram, locale compliance, criterion
  linkage (question references a criterion present in context), evidence-ref
  precision, length, provoke agreement with expectation.
- **FR-033** Optional LLM-judge rubric (Sarkar provocation quality: specific,
  criterion-linked, answerable by observation, non-leading) reported in a
  separate section labelled AI judgment; never a sole merge gate (OD-4).
- **FR-034** Output: JSON report + Markdown summary; `--compare <baseline>`
  prints a before/after diff.

#### Theme B2 — 가드 필수 종결 → Stage **S-080**

- **FR-040** CI check `verify:qa-ledger`: schema-valid; every `fixed`/`verified`
  defect has a guard; the guard resolves **through the test runner**, not
  source grep (vitest JSON reporter test ids, `cargo test -- --list` names,
  eval fixture ids, live-scenario run records newer than the fix commit).
- **FR-041** A guard that is listed but skipped/ignored fails the check.

### Wave 3 — Closing the return path

#### Theme A4 — 현장 피드백 집계 → Stage **S-081**

- **FR-050** `scripts/analyze-cards.mjs` over one or many exports (fresh salt
  per export → aggregate on non-identifying keys only): per (event, concern,
  mode, promptVersion, policyVersion, model): exposures, action / dismiss /
  mark-irrelevant / continued-with-risk / unanswered rates, median response
  latency, supervisor drop-reason distribution. `origin != classroom` excluded
  unless flagged.
- **FR-051** Exemplar extraction: evaluation ids with `marked_irrelevant` or
  high unanswered rates, resolvable to local replay records for **human-reviewed,
  anonymized** promotion into eval fixtures. Promotion is never automatic.

#### Theme B3 — 실행 기록·재실행 큐 → Stage **S-082**

- **FR-060** Live QA runs write `docs/qa/ledger/runs/<date>-<id>.json`: build
  (version + commit), scenarios executed + result, defects opened/verified,
  evidence paths + sha256 (binaries stay gitignored).
- **FR-061** `qa:queue` computes the next run set: scenarios linked to
  `fixed`-unverified defects, scenarios whose area globs intersect changes since
  their last pass, stale scenarios. Emits a live-QA work order (macOS release
  `.app` + computer-use, per existing harness practice).

### Wave 4 — First cycles (dogfood)

#### Theme A5 — 개선 사이클 프로토콜 + 1회차 → Stage **S-083**

- **FR-070** Runbook + harness work-order template: inputs (A4 aggregate,
  A3 dev-split report, exemplars) → one candidate change per cycle (prompt text,
  `SupervisionPolicy` value, action allowlist) → version bump → A3 on dev +
  holdout with `--compare` → PR carrying the report → owner approval → release
  note records the versions.
- **FR-071** Merge gate: no holdout regression beyond tolerance on
  deterministic metrics; any Constitution violation (static fallback,
  non-question, missing evidence) is a hard fail.
- **FR-072** Execute one full cycle end-to-end as proof (target: the weakest
  metric from the first A3 baseline).

#### Theme B4 — 원장 → spec/Stage 브리지 + 1회차 → Stage **S-084**

- **FR-080** `qa:triage` clusters open defects by area/severity and drafts
  spec-theme stubs + Wily Stage payload drafts (drafts only; registration stays
  a human/root action). A3 regressions enter the ledger as `source: eval`.
- **FR-081** Run one full B cycle: `qa:queue` → live run → ledger update →
  triage draft.

## Cross-Loop Contracts

- A3 regressions → B1 defects (`source: eval`, guard kind `eval-fixture`).
- B3 live runs tag sessions `origin: qa` (FR-006) so they feed A4 only when
  explicitly included.
- Versions (`promptVersion`, `policyVersion`) are the join key between the
  field (A4), the bench (A3), and releases.

## Owner Decisions (resolved 2026-09-29 — recommended defaults approved)

| ID | Question | Resolution |
| --- | --- | --- |
| OD-1 | Replay capture (A2) default | **Local ON**, retention 500 records / 30 days, clearable. The same context is already sent to the provider; local storage adds no new recipient. |
| OD-2 | Question text in default export | **Plain text** — it is AI output and the core analysis unit; still passes the existing PII/secret detector. |
| OD-3 | Ledger seed scope | **Open items only**: the 70 surviving findings of `post-cleanup-review-2026-07-22.md` (re-checked for current validity) + all new findings. |
| OD-4 | LLM-judge in A3 | **Advisory section only**, never a gate. |
| OD-5 | Live-eval model/budget | Owner's configured OpenRouter key; cap per run (e.g. ≤ 2× fixture count calls). |

## Success Criteria

- **SC-001** 100% of supervisor/coach/PRD evaluation events in a fresh export
  carry `promptVersion`; supervisor events carry `policyVersion`.
- **SC-002** Every `provocation.card_shown` in an export has exactly one
  terminal event (response or `card_unanswered`) — export test.
- **SC-003** Export test: zero `provocation.*` events of a session missing from
  its export.
- **SC-004** A3 recorded mode runs in CI; live mode produces a baseline report
  for the current prompt on the ≥30-fixture golden set.
- **SC-005** One A cycle merged with a before/after report and a new
  `promptVersion` or `policyVersion` (S-083).
- **SC-006** `verify:qa-ledger` green in CI; every `fixed`/`verified` defect's
  guard resolves via its runner.
- **SC-007** One B cycle recorded: `qa:queue` output → run JSON → ledger
  transitions → triage draft (S-084).

## Execution Model

Harness mode per owner rhythm: after approval → `plan.md` + `tasks.md` → Wily
Stages S-076–S-084 → autonomous stage-by-stage implementation with root-owned
CI (rust fmt/clippy/test + frontend format/typecheck/lint) and adversarial
review per stage. Waves are ordered; within Wave 1 and Wave 2, A and B stages
touch disjoint areas and may run in parallel worktrees.

## Constitution Check

- I (real workflow): no new surfaces; no lesson track. ✅
- II (evidence before intervention): unchanged; FR-071 hard-fails violations. ✅
- III (Pi only): eval live mode uses the same provider path; no fallback. ✅
- IV (ledger): strengthens it — versions, question text, terminal events, export
  gap fix; replay corpus local and excluded from default export. ✅
- V (low friction): no new gates; no runtime suppression. ✅
- VI (determinism): policy centralized as typed versioned constants, unit
  tested; LLM-judge advisory only. ✅
- VII (unrestricted kinds): untouched. ✅
